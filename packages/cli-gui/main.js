const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { GeminiClient, GeminiChat, createContentGenerator, AuthType, tokenLimit, ToolConfirmationOutcome, ShellTool, getAllGeminiMdFilenames } = require('@google/gemini-cli-core');
const { ApprovalMode } = require('@google/gemini-cli-core/dist/src/config/config.js');
const { retryWithBackoff } = require('@google/gemini-cli-core/dist/src/utils/retry.js');
const { loadCliConfig } = require('../cli/dist/src/config/config.js');
const { loadSettings } = require('../cli/dist/src/config/settings.js');
const { loadExtensions } = require('../cli/dist/src/config/extension.js');
const Store = require('electron-store');
const { shortenPath, tildeifyPath } = require('@google/gemini-cli-core/dist/src/utils/paths.js');
const simpleGit = require('simple-git');

const store = new Store();
const pendingToolCalls = new Map();
const chatInstances = new Map();
let mainWindow;
let initialWorkspaceRoot;

// Centralized state with logs for each task
const tasks = store.get('tasks', {
  running: [],
  history: []
});

// Move any running tasks to history on startup
if (tasks.running.length > 0) {
  tasks.history.unshift(...tasks.running);
  tasks.running = [];
}

let chat;
let config;
let contentGenerator;
let client;

async function initializeChat() {
    const workspaceRoot = path.join(__dirname, '../..'); // project root
    if (!initialWorkspaceRoot) {
        initialWorkspaceRoot = workspaceRoot;
    }
    const settings = loadSettings(workspaceRoot);
    const extensions = loadExtensions(workspaceRoot);
    const sessionId = `desktop-app-${Date.now()}`;

    config = await loadCliConfig(settings.merged, extensions, sessionId);

    let authType = settings.merged.selectedAuthType;
    if (!authType && process.env.GEMINI_API_KEY) {
        authType = 'gemini-api-key'; // AuthType.USE_GEMINI
    }

    if (!authType) {
        authType = 'gemini-api-key';
    }

    await config.refreshAuth(authType);
    contentGenerator = await createContentGenerator(config.getContentGeneratorConfig(), config.getSessionId());
    client = new GeminiClient(config);
    await client.initialize(config.getContentGeneratorConfig());
    chat = client.getChat();
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1c1c1e',
  });

  mainWindow.loadFile('dashboard.html');
  
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('update-tasks', tasks);
  });
}

app.whenReady().then(async () => {
    await initializeChat();
    createWindow();
});

app.on('window-all-closed', () => {
  if (tasks.running.length > 0) {
    tasks.history.unshift(...tasks.running);
    tasks.running = [];
  }
  store.set('tasks', tasks);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

async function sendStatusUpdate() {
    if (!mainWindow) return;
    try {
        const sandboxEnabled = config.getSandbox()?.enabled || false;
        const history = chat.getHistory();
        const model = config.getModel();
        let totalTokens = 0;
        if (history.length > 0) {
            const { totalTokens: tokens } = await contentGenerator.countTokens({
                model,
                contents: history,
            });
            totalTokens = tokens;
        }

        const limit = tokenLimit(model);
        const percentage = limit > 0 ? totalTokens / limit : 0;

        const git = simpleGit(config.getWorkingDir());
        const branchName = (await git.branch()).current;

        const statusInfo = {
            cwd: shortenPath(tildeifyPath(config.getWorkingDir()), 70),
            sandbox: sandboxEnabled,
            model,
            contextWindow: `${((1 - percentage) * 100).toFixed(0)}%`,
            branchName,
        };
        mainWindow.webContents.send('update-status-info', statusInfo);
    } catch (error) {
        console.error('Error sending status update:', error);
    }
}

async function handleStream(stream, task, taskId) {
    let toolCallOccurred = false;
    // Ensure there's an empty Gemini message to populate
    if (task.log.length === 0 || task.log[task.log.length - 1].sender !== 'Gemini' || task.log[task.log.length - 1].content !== '') {
        task.log.push({ sender: 'Gemini', content: '' });
    }

    for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.text) {
                task.log[task.log.length - 1].content += part.text;
                mainWindow.webContents.send('update-task-state', task);
            }
            if (part.functionCall) {
                toolCallOccurred = true;
                const toolRegistry = await config.getToolRegistry();
                const tool = toolRegistry.getTool(part.functionCall.name);
                const callId = crypto.randomUUID();
                pendingToolCalls.set(callId, part.functionCall);

                let type = 'info'; // default
                if (part.functionCall.name.includes('edit')) type = 'edit';
                if (part.functionCall.name.includes('shell')) type = 'exec';

                const confirmationDetails = {
                    ...part.functionCall,
                    callId,
                    type,
                    description: tool?.description || '',
                    taskId: task.id,
                };
                task.pendingToolCall = confirmationDetails;
                mainWindow.webContents.send('tool-call', { taskId: task.id, toolCall: confirmationDetails });
            }
        }
    }
    return toolCallOccurred;
}

// --- IPC Handlers for State Management ---

ipcMain.on('navigate-to-chat', (event, taskId) => {
    const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
        if (!chatInstances.has(taskId)) {
            const newChat = client.getChat();
            newChat.history = task.log.map(logEntry => {
                if (logEntry.sender === 'You') {
                    return { role: 'user', parts: [{ text: logEntry.content }] };
                } else if (logEntry.sender === 'Gemini' && logEntry.content) {
                    return { role: 'model', parts: [{ text: logEntry.content }] };
                }
                return null;
            }).filter(Boolean);
            chatInstances.set(taskId, newChat);
        }

        if (!task.config) {
            task.config = {};
        }
        task.config.geminiMdFileCount = config.getGeminiMdFileCount();
        task.config.contextFileNames = getAllGeminiMdFilenames();
        task.config.mcpServers = config.getMcpServers();
        mainWindow.loadFile('chat.html');
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('load-chat', task);
        });
    }
});

ipcMain.on('create-new-task', () => {
    const newTaskId = `task-${Date.now()}`;
    const newChat = client.getChat();
    chatInstances.set(newTaskId, newChat);

    const newTask = {
        id: newTaskId,
        title: 'New Task',
        description: 'A new task session.',
        timestamp: new Date().toISOString(),
        log: [{ sender: 'Gemini', content: 'Hello! How can I help you today?' }],
        config: {
            geminiMdFileCount: config.getGeminiMdFileCount(),
            contextFileNames: getAllGeminiMdFilenames(),
            mcpServers: config.getMcpServers(),
        }
    };
    tasks.running.unshift(newTask);
    mainWindow.loadFile('chat.html');
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('load-chat', newTask);
    });
});

ipcMain.on('navigate-to-dashboard', (event) => {
    mainWindow.loadFile('dashboard.html');
});

ipcMain.on('send-message', async (event, { taskId, message, acceptingEdits }) => {
    const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);
    const chat = chatInstances.get(taskId);

    if (task && chat) {
        if (task.title === 'New Task') {
            task.title = message.split(' ').slice(0, 5).join(' ');
        }
        
        // Sync chat history with the task log
        chat.history = task.log.map(logEntry => {
            if (logEntry.sender === 'You') {
                return { role: 'user', parts: [{ text: logEntry.content }] };
            } else if (logEntry.sender === 'Gemini' && logEntry.content) {
                return { role: 'model', parts: [{ text: logEntry.content }] };
            }
            return null;
        }).filter(Boolean);

        task.log.push({ sender: 'You', content: message });
        task.startTime = new Date().toISOString();
        task.isThinking = true;
        mainWindow.webContents.send('update-task-state', task);

        try {
            const approvalMode = acceptingEdits ? ApprovalMode.AUTO_EDIT : ApprovalMode.DEFAULT;
            config.setApprovalMode(approvalMode);

            const stream = await retryWithBackoff(() => chat.sendMessageStream({ message }), {
                onPersistent429: async () => {
                    const newModel = await client.handleFlashFallback(config.getContentGeneratorConfig()?.authType);
                    if (newModel) {
                        mainWindow.webContents.send('flash-model-fallback', { newModel });
                    }
                    return newModel;
                },
                authType: config.getContentGeneratorConfig()?.authType,
            });

            const toolCallOccurred = await handleStream(stream, task, taskId);

            if (!toolCallOccurred) {
                task.startTime = null;
                task.isThinking = false;
                mainWindow.webContents.send('update-task-state', task);
                mainWindow.webContents.send('response-received', { taskId });
            }
        } catch (error) {
            console.error(error);
            task.startTime = null;
            task.isThinking = false;
            mainWindow.webContents.send('update-task-state', task);
            task.log.pop(); // Remove the empty Gemini message
            task.log.push({ sender: 'Gemini', content: `Error: ${error.message}` });
            if (!task.config) {
                task.config = {};
            }
            task.config.geminiMdFileCount = config.getGeminiMdFileCount();
            task.config.contextFileNames = getAllGeminiMdFilenames();
            task.config.mcpServers = config.getMcpServers();
            mainWindow.webContents.send('load-chat', task);
            mainWindow.webContents.send('response-received');
        } finally {
            sendStatusUpdate();
        }
    } else {
        console.error(`Task with ID ${taskId} not found.`);
    }
});

ipcMain.on('tool-call-response', async (event, { outcome, toolCall }) => {
    const originalToolCall = pendingToolCalls.get(toolCall.callId);
    if (!originalToolCall) {
        console.error(`Tool call with ID ${toolCall.callId} not found.`);
        return;
    }
    pendingToolCalls.delete(toolCall.callId);

    const allTasks = [...tasks.running, ...tasks.history];
    const task = allTasks.find(t => t.id === toolCall.taskId);
    const chat = chatInstances.get(toolCall.taskId);

    if (task) {
        task.pendingToolCall = null;
    }

    const toolRegistry = await config.getToolRegistry();
    let toolResponseParts = [];

    if (outcome === 'proceed_once' || outcome === 'proceed_always') {
        if (outcome === 'proceed_always') {
            store.set(`tool-approval-${originalToolCall.name}`, true);
        }

        const tool = toolRegistry.getTool(originalToolCall.name);
        if (tool) {
            try {
                const result = await tool.execute(originalToolCall.args, new AbortController().signal);
                toolResponseParts = result.llmContent;
            } catch (e) {
                toolResponseParts = [{
                    functionResponse: {
                        name: originalToolCall.name,
                        response: { error: `Error executing tool: ${e.message}` },
                    },
                }];
            }
        } else {
            toolResponseParts = [{
                functionResponse: {
                    name: originalToolCall.name,
                    response: { error: `Tool not found: ${originalToolCall.name}` },
                },
            }];
        }
    } else {
        toolResponseParts = [{
            functionResponse: {
                name: originalToolCall.name,
                response: { error: 'Tool call denied by user.' },
            },
        }];
    }

    // Continue the conversation by sending the tool response parts as the new message.
    if (task && chat) {
        mainWindow.webContents.send('update-task-state', task);
        chat.history = task.log.map(logEntry => {
            if (logEntry.sender === 'You') {
                return { role: 'user', parts: [{ text: logEntry.content }] };
            } else if (logEntry.sender === 'Gemini' && logEntry.content) {
                return { role: 'model', parts: [{ text: logEntry.content }] };
            }
            return null;
        }).filter(Boolean);
    }
    
    const stream = await retryWithBackoff(() => chat.sendMessageStream({ message: toolResponseParts }), {
        onPersistent429: async () => {
            const newModel = await client.handleFlashFallback(config.getContentGeneratorConfig()?.authType);
            if (newModel) {
                mainWindow.webContents.send('flash-model-fallback', { newModel });
            }
            return newModel;
        },
        authType: config.getContentGeneratorConfig()?.authType,
    });

    if (task) {
        const toolCallOccurred = await handleStream(stream, task, toolCall.taskId);
        if (!toolCallOccurred) {
            task.startTime = null;
            task.isThinking = false;
            mainWindow.webContents.send('update-task-state', task);
            mainWindow.webContents.send('response-received', { taskId: toolCall.taskId });
        }
    } else {
        // If the task is not found, we should still send a response to the renderer
        // to prevent the UI from being stuck in a loading state.
        const allTasks = [...tasks.running, ...tasks.history];
        const taskToUpdate = allTasks.find(t => t.id === toolCall.taskId);
        if (taskToUpdate) {
            taskToUpdate.startTime = null;
            taskToUpdate.isThinking = false;
            mainWindow.webContents.send('update-task-state', taskToUpdate);
        }
        mainWindow.webContents.send('response-received', { taskId: toolCall.taskId });
    }
    sendStatusUpdate();
});

ipcMain.on('stop-task', (event, taskId) => {
    const taskIndex = tasks.running.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        const [task] = tasks.running.splice(taskIndex, 1);
        task.timestamp = new Date().toISOString();
        tasks.history.unshift(task);
        chatInstances.delete(taskId);
        mainWindow.webContents.send('update-tasks', tasks);
    }
});

ipcMain.on('get-status-info', async (event) => {
    sendStatusUpdate();
});

ipcMain.on('navigate-to-dashboard', (event) => {
    mainWindow.loadFile('dashboard.html');
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('update-tasks', tasks);
    });
});

ipcMain.on('get-tasks', (event) => {
    event.sender.send('update-tasks', tasks);
});

ipcMain.on('clear-history', () => {
    for (const task of tasks.history) {
        chatInstances.delete(task.id);
    }
    tasks.history = [];
    store.set('tasks', tasks);
    mainWindow.webContents.send('update-tasks', tasks);
});

ipcMain.on('execute-shell-command', async (event, { taskId, command }) => {
    const allTasks = [...tasks.running, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
        task.log.push({ sender: 'You', content: `$ ${command}` });
        const shellTool = new ShellTool(config);
        try {
            const { returnDisplay } = await shellTool.execute({ command }, new AbortController().signal);
            if (returnDisplay) {
                task.log.push({ sender: 'system', content: returnDisplay });
            } else {
                task.log.push({ sender: 'system', content: 'ℹ (Command produced no output)' });
            }
        } catch (error) {
            task.log.push({ sender: 'system', content: `Error executing command: ${error.message}` });
        } finally {
            mainWindow.webContents.send('load-chat', task);
            sendStatusUpdate();
        }
    }
});

ipcMain.on('change-directory', async (event, { taskId, directory, command }) => {
    const allTasks = [...tasks.running, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
        task.log.push({ sender: 'You', content: `$ ${command}` });
        try {
            const newPath = path.resolve(process.cwd(), directory);
            if (!newPath.startsWith(initialWorkspaceRoot)) {
                task.log.push({ sender: 'system', content: `WARNING: Cannot cd outside of project root (${initialWorkspaceRoot})` });
            } else {
                process.chdir(newPath);
                await initializeChat();
                task.log.push({ sender: 'system', content: `Changed directory to ${newPath}` });
            }
        } catch (error) {
            task.log.push({ sender: 'system', content: `Error changing directory: ${error.message}` });
        } finally {
            mainWindow.webContents.send('load-chat', task);
            sendStatusUpdate();
        }
    }
});