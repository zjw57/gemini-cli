const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { GeminiClient, GeminiChat, createContentGenerator, AuthType, tokenLimit, ToolConfirmationOutcome } = require('../core/dist');
const { ApprovalMode } = require('../core/dist/src/config/config.js');
const { retryWithBackoff } = require('../core/dist/src/utils/retry.js');
const { loadCliConfig } = require('../cli/dist/src/config/config.js');
const { loadSettings } = require('../cli/dist/src/config/settings.js');
const { loadExtensions } = require('../cli/dist/src/config/extension.js');
const Store = require('electron-store');
const { shortenPath, tildeifyPath } = require('../core/dist/src/utils/paths.js');
const simpleGit = require('simple-git');

const store = new Store();
const pendingToolCalls = new Map();
let mainWindow;

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

async function handleStream(stream, task) {
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
                mainWindow.webContents.send('stream-chunk', { chunk: part.text });
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
                mainWindow.webContents.send('tool-call', confirmationDetails);
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
        mainWindow.loadFile('chat.html');
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('load-chat', task);
        });
    }
});

ipcMain.on('create-new-task', () => {
    const newTaskId = `task-${Date.now()}`;
    const newTask = {
        id: newTaskId,
        title: 'New Task',
        description: 'A new task session.',
        timestamp: 'Just now',
        log: [{ sender: 'Gemini', content: 'Hello! How can I help you today?' }]
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

    if (task) {
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
        mainWindow.webContents.send('thinking');

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

            const toolCallOccurred = await handleStream(stream, task);

            if (!toolCallOccurred) {
                mainWindow.webContents.send('response-received');
            }
        } catch (error) {
            console.error(error);
            task.log.pop(); // Remove the empty Gemini message
            task.log.push({ sender: 'Gemini', content: `Error: ${error.message}` });
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

    const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
    const task = allTasks.find(t => t.id === toolCall.taskId);
    if (task) {
        const toolCallOccurred = await handleStream(stream, task);
        if (!toolCallOccurred) {
            mainWindow.webContents.send('response-received');
        }
    }
    sendStatusUpdate();
});

ipcMain.on('stop-task', (event, taskId) => {
    const taskIndex = tasks.running.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        const [task] = tasks.running.splice(taskIndex, 1);
        task.timestamp = 'Just now';
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
    tasks.history = [];
    store.set('tasks', tasks);
    mainWindow.webContents.send('update-tasks', tasks);
});