import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import {
  GeminiClient,
  GeminiChat,
  createContentGenerator,
  AuthType,
  tokenLimit,
  ShellTool,
  getAllGeminiMdFilenames,
  Config,
  ContentGenerator,
  ServerGeminiStreamEvent,
  shortenPath,
  tildeifyPath,
} from '@google/gemini-cli-core';
import { Part } from '@google/genai';
import { ApprovalMode } from '@google/gemini-cli-core';
import { loadCliConfig } from '../cli/src/config/config';
import { loadSettings } from '../cli/src/config/settings'
import { loadExtensions } from '../cli/src/config/extension';
import Store from 'electron-store';
import simpleGit from 'simple-git';

const store = new Store();
const pendingToolCalls = new Map<string, { name: string; args: any }>();
const requestControllers = new Map<string, AbortController>();
const chatInstances = new Map<string, GeminiChat>();
let mainWindow: BrowserWindow | null;
let initialWorkspaceRoot: string;

interface Task {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  log: { sender: string; content: string }[];
  config: any;
  isThinking: boolean;
  startTime: string | null;
  thought: { subject: string; description: string } | null;
  pendingToolCall: any;
}

const tasks: {
  running: Task[];
  history: Task[];
  favorites: Task[];
} = store.get('tasks', {
  running: [],
  history: [],
  favorites: [],
});

if (tasks.running.length > 0) {
  tasks.history.unshift(...tasks.running);
  tasks.running = [];
}

let chat: GeminiChat;
let config: Config;
let contentGenerator: ContentGenerator;
let client: GeminiClient;

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
  contentGenerator = await createContentGenerator(
    config.getContentGeneratorConfig(),
    config.getSessionId(),
  );
  client = new GeminiClient(config);
  await client.initialize(config.getContentGeneratorConfig());
  chat = client.getChat();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1c1c1e',
  });

  mainWindow.loadFile('dashboard.html');

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow!.webContents.send('update-tasks', tasks);
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
      totalTokens = tokens!;
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

async function handleStream(
  stream: AsyncGenerator<ServerGeminiStreamEvent>,
  task: Task,
  taskId: string,
) {
  let toolCallOccurred = false;
  // Ensure there's an empty Gemini message to populate
  if (
    task.log.length === 0 ||
    task.log[task.log.length - 1].sender !== 'Gemini'
  ) {
    task.log.push({ sender: 'Gemini', content: '' });
  }

  for await (const event of stream) {
    switch (event.type) {
      case 'content': // GeminiEventType.Content
        task.thought = null;
        task.log[task.log.length - 1].content += event.value;
        mainWindow!.webContents.send('update-task-state', task);
        break;
      case 'thought': // GeminiEventType.Thought
        task.thought = event.value;
        mainWindow!.webContents.send('update-task-state', task);
        break;
      case 'tool_call_request': // GeminiEventType.ToolCallRequest
        toolCallOccurred = true;
        const toolRegistry = await config.getToolRegistry();
        const tool = toolRegistry.getTool(event.value.name);
        const callId = event.value.callId;
        pendingToolCalls.set(callId, {
          name: event.value.name,
          args: event.value.args,
        });

        let type = 'info'; // default
        if (event.value.name.includes('edit')) type = 'edit';
        if (event.value.name.includes('shell')) type = 'exec';

        const confirmationDetails = {
          name: event.value.name,
          args: event.value.args,
          callId,
          type,
          description: tool?.description || '',
          taskId: task.id,
        };
        task.pendingToolCall = confirmationDetails;
        mainWindow!.webContents.send('tool-call', {
          taskId: task.id,
          toolCall: confirmationDetails,
        });
        break;
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
      newChat.history = task.log
        .map(logEntry => {
          if (logEntry.sender === 'You') {
            return { role: 'user', parts: [{ text: logEntry.content }] };
          } else if (logEntry.sender === 'Gemini' && logEntry.content) {
            return { role: 'model', parts: [{ text: logEntry.content }] };
          }
          return null;
        })
        .filter(Boolean) as Part[];
      chatInstances.set(taskId, newChat);
    }

    if (!task.config) {
      task.config = {};
    }
    task.config.geminiMdFileCount = config.getGeminiMdFileCount();
    task.config.contextFileNames = getAllGeminiMdFilenames();
    task.config.mcpServers = config.getMcpServers();
    mainWindow!.loadFile('chat.html');
    mainWindow!.webContents.once('did-finish-load', () => {
      mainWindow!.webContents.send('load-chat', task);
    });
  }
});

ipcMain.on('create-new-task', () => {
  const newTaskId = `task-${Date.now()}`;
  const newChat = client.getChat();
  chatInstances.set(newTaskId, newChat);

  const newTask: Task = {
    id: newTaskId,
    title: 'New Task',
    description: 'A new task session.',
    timestamp: new Date().toISOString(),
    log: [{ sender: 'Gemini', content: 'Hello! How can I help you today?' }],
    config: {
      geminiMdFileCount: config.getGeminiMdFileCount(),
      contextFileNames: getAllGeminiMdFilenames(),
      mcpServers: config.getMcpServers(),
    },
    isThinking: false,
    startTime: null,
    thought: null,
    pendingToolCall: null,
  };
  tasks.running.unshift(newTask);
  mainWindow!.loadFile('chat.html');
  mainWindow!.webContents.once('did-finish-load', () => {
    mainWindow!.webContents.send('load-chat', newTask);
  });
});

ipcMain.on('navigate-to-dashboard', event => {
  mainWindow!.loadFile('dashboard.html');
});

ipcMain.on(
  'send-message',
  async (event, { taskId, message, acceptingEdits }) => {
    const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);
    const chat = chatInstances.get(taskId);

    if (task && chat) {
      if (task.title === 'New Task') {
        task.title = message.split(' ').slice(0, 5).join(' ');
      }

      // Sync chat history with the task log
      chat.history = task.log
        .map(logEntry => {
          if (logEntry.sender === 'You') {
            return { role: 'user', parts: [{ text: logEntry.content }] };
          } else if (logEntry.sender === 'Gemini' && logEntry.content) {
            return { role: 'model', parts: [{ text: logEntry.content }] };
          }
          return null;
        })
        .filter(Boolean) as Part[];

      task.log.push({ sender: 'You', content: message });
      task.startTime = new Date().toISOString();
      task.isThinking = true;
      mainWindow!.webContents.send('update-task-state', task);

      try {
        const approvalMode = acceptingEdits
          ? ApprovalMode.AUTO_EDIT
          : ApprovalMode.DEFAULT;
        config.setApprovalMode(approvalMode);

        const controller = new AbortController();
        requestControllers.set(taskId, controller);

        const stream = client.sendMessageStream(
          [{ text: message }],
          controller.signal,
        );

        const toolCallOccurred = await handleStream(stream, task, taskId);

        if (!toolCallOccurred) {
          task.startTime = null;
          task.isThinking = false;
          mainWindow!.webContents.send('update-task-state', task);
          mainWindow!.webContents.send('response-received', { taskId });
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          task.log.push({ sender: 'Gemini', content: 'Request cancelled.' });
        } else {
          console.error(error);
          task.log.push({
            sender: 'Gemini',
            content: `Error: ${(error as Error).message}`,
          });
        }
        task.startTime = null;
        task.isThinking = false;
        task.thought = null;
        mainWindow!.webContents.send('update-task-state', task);
        if (task.log[task.log.length - 2].sender === 'Gemini') {
          task.log.pop(); // Remove the empty Gemini message
        }
        if (!task.config) {
          task.config = {};
        }
        task.config.geminiMdFileCount = config.getGeminiMdFileCount();
        task.config.contextFileNames = getAllGeminiMdFilenames();
        task.config.mcpServers = config.getMcpServers();
        mainWindow!.webContents.send('load-chat', task);
        mainWindow!.webContents.send('response-received');
      } finally {
        requestControllers.delete(taskId);
        sendStatusUpdate();
      }
    } else {
      console.error(`Task with ID ${taskId} not found.`);
    }
  },
);

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
  let toolResponseParts: Part[] = [];

  if (outcome === 'proceed_once' || outcome === 'proceed_always') {
    if (outcome === 'proceed_always') {
      store.set(`tool-approval-${originalToolCall.name}`, true);
    }

    const tool = toolRegistry.getTool(originalToolCall.name);
    if (tool) {
      try {
        const result = await tool.execute(
          originalToolCall.args,
          new AbortController().signal,
        );
        toolResponseParts = result.llmContent as Part[];
      } catch (e) {
        toolResponseParts = [
          {
            functionResponse: {
              name: originalToolCall.name,
              response: { error: `Error executing tool: ${(e as Error).message}` },
            },
          },
        ];
      }
    } else {
      toolResponseParts = [
        {
          functionResponse: {
            name: originalToolCall.name,
            response: { error: `Tool not found: ${originalToolCall.name}` },
          },
        },
      ];
    }
  } else {
    toolResponseParts = [
      {
        functionResponse: {
          name: originalToolCall.name,
          response: { error: 'Tool call denied by user.' },
        },
      },
    ];
  }

  // Continue the conversation by sending the tool response parts as the new message.
  if (task && chat) {
    mainWindow!.webContents.send('update-task-state', task);
    chat.history = task.log
      .map(logEntry => {
        if (logEntry.sender === 'You') {
          return { role: 'user', parts: [{ text: logEntry.content }] };
        } else if (logEntry.sender === 'Gemini' && logEntry.content) {
          return { role: 'model', parts: [{ text: logEntry.content }] };
        }
        return null;
      })
      .filter(Boolean) as Part[];
  }

  const controller = new AbortController();
  requestControllers.set(toolCall.taskId, controller);

  try {
    const stream = client.sendMessageStream(
      toolResponseParts,
      controller.signal,
    );

    if (task) {
      const toolCallOccurred = await handleStream(stream, task, toolCall.taskId);
      if (!toolCallOccurred) {
        task.startTime = null;
        task.isThinking = false;
        mainWindow!.webContents.send('update-task-state', task);
        mainWindow!.webContents.send('response-received', {
          taskId: toolCall.taskId,
        });
      }
    } else {
      // If the task is not found, we should still send a response to the renderer
      // to prevent the UI from being stuck in a loading state.
      const allTasks = [...tasks.running, ...tasks.history];
      const taskToUpdate = allTasks.find(t => t.id === toolCall.taskId);
      if (taskToUpdate) {
        taskToUpdate.startTime = null;
        taskToUpdate.isThinking = false;
        mainWindow!.webContents.send('update-task-state', taskToUpdate);
      }
      mainWindow!.webContents.send('response-received', {
        taskId: toolCall.taskId,
      });
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      if (task) {
        task.log.push({ sender: 'Gemini', content: 'Request cancelled.' });
      }
    } else {
      console.error(error);
      if (task) {
        task.log.push({
          sender: 'Gemini',
          content: `Error: ${(error as Error).message}`,
        });
      }
    }
    if (task) {
      task.startTime = null;
      task.isThinking = false;
      task.thought = null;
      mainWindow!.webContents.send('update-task-state', task);
    }
  } finally {
    requestControllers.delete(toolCall.taskId);
    sendStatusUpdate();
  }
});

ipcMain.on('stop-task', (event, taskId) => {
  const taskIndex = tasks.running.findIndex(t => t.id === taskId);
  if (taskIndex > -1) {
    const [task] = tasks.running.splice(taskIndex, 1);
    task.timestamp = new Date().toISOString();
    tasks.history.unshift(task);
    chatInstances.delete(taskId);
    mainWindow!.webContents.send('update-tasks', tasks);
  }
});

ipcMain.on('get-status-info', async event => {
  sendStatusUpdate();
});

ipcMain.on('navigate-to-dashboard', event => {
  mainWindow!.loadFile('dashboard.html');
  mainWindow!.webContents.once('did-finish-load', () => {
    mainWindow!.webContents.send('update-tasks', tasks);
  });
});

ipcMain.on('get-tasks', event => {
  event.sender.send('update-tasks', tasks);
});

ipcMain.on('clear-history', () => {
  for (const task of tasks.history) {
    chatInstances.delete(task.id);
  }
  tasks.history = [];
  store.set('tasks', tasks);
  mainWindow!.webContents.send('update-tasks', tasks);
});

ipcMain.on('delete-task', (event, taskId) => {
  let taskIndex = tasks.running.findIndex(t => t.id === taskId);
  if (taskIndex > -1) {
    tasks.running.splice(taskIndex, 1);
  } else {
    taskIndex = tasks.history.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
      tasks.history.splice(taskIndex, 1);
    }
  }

  if (taskIndex > -1) {
    chatInstances.delete(taskId);
    store.set('tasks', tasks);
    mainWindow!.webContents.send('update-tasks', tasks);
  }
});

ipcMain.on('execute-shell-command', async (event, { taskId, command }) => {
  const allTasks = [...tasks.running, ...tasks.history];
  const task = allTasks.find(t => t.id === taskId);
  if (task) {
    task.log.push({ sender: 'You', content: `$ ${command}` });
    const shellTool = new ShellTool(config);
    try {
      const { returnDisplay } = await shellTool.execute(
        { command },
        new AbortController().signal,
      );
      if (returnDisplay) {
        task.log.push({ sender: 'system', content: returnDisplay });
      } else {
        task.log.push({
          sender: 'system',
          content: 'ℹ (Command produced no output)',
        });
      }
    } catch (error) {
      task.log.push({
        sender: 'system',
        content: `Error executing command: ${(error as Error).message}`,
      });
    } finally {
      mainWindow!.webContents.send('load-chat', task);
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
        task.log.push({
          sender: 'system',
          content: `WARNING: Cannot cd outside of project root (${initialWorkspaceRoot})`,
        });
      } else {
        process.chdir(newPath);
        await initializeChat();
        task.log.push({
          sender: 'system',
          content: `Changed directory to ${newPath}`,
        });
      }
    } catch (error) {
      task.log.push({
        sender: 'system',
        content: `Error changing directory: ${(error as Error).message}`,
      });
    } finally {
      mainWindow!.webContents.send('load-chat', task);
      sendStatusUpdate();
    }
  }
});

ipcMain.on('cancel-request', (event, taskId) => {
  const controller = requestControllers.get(taskId);
  if (controller) {
    controller.abort();
    requestControllers.delete(taskId);
  }
});
