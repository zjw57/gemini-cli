const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { GeminiChat, createContentGenerator, AuthType, tokenLimit } = require('../core/dist');
const { loadCliConfig } = require('../cli/dist/src/config/config.js');
const { loadSettings } = require('../cli/dist/src/config/settings.js');
const { loadExtensions } = require('../cli/dist/src/config/extension.js');
const Store = require('electron-store');
const { shortenPath, tildeifyPath } = require('../core/dist/src/utils/paths.js');

const store = new Store();
let mainWindow;

// Centralized state with logs for each task
const tasks = store.get('tasks', {
  running: [],
  favorites: [],
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
    chat = new GeminiChat(config, contentGenerator);
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1c1c1e',
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow.webContents.getURL().endsWith('index.html')) {
        mainWindow.webContents.send('update-tasks', tasks);
    }
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

// --- IPC Handlers for State Management ---

ipcMain.on('navigate-to-chat', (event, taskId) => {
    mainWindow.loadFile('chat.html');
    
    mainWindow.webContents.once('did-finish-load', () => {
        const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
        const task = allTasks.find(t => t.id === taskId);
        if (task) {
            mainWindow.webContents.send('load-chat', task);
        }
    });
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

ipcMain.on('send-message', async (event, { taskId, message }) => {
    console.log(`Received 'send-message' IPC event with taskId: ${taskId}`);
    const allTasks = [...tasks.running, ...tasks.favorites, ...tasks.history];
    const task = allTasks.find(t => t.id === taskId);

    if (task) {
        if (task.title === 'New Task') {
            task.title = message.split(' ').slice(0, 5).join(' ');
        }
        task.log.push({ sender: 'You', content: message });
        // Add an empty message for Gemini that we will populate
        task.log.push({ sender: 'Gemini', content: '' });
        mainWindow.webContents.send('load-chat', task);
        mainWindow.webContents.send('thinking');

        try {
            const stream = await chat.sendMessageStream({ message });
            for await (const chunk of stream) {
                const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                if (chunkText) {
                    task.log[task.log.length - 1].content += chunkText;
                    mainWindow.webContents.send('stream-chunk', { chunk: chunkText });
                }
            }
            mainWindow.webContents.send('response-received');
        } catch (error) {
            console.error(error);
            task.log.pop(); // Remove the empty Gemini message
            task.log.push({ sender: 'Gemini', content: `Error: ${error.message}` });
            mainWindow.webContents.send('load-chat', task);
            mainWindow.webContents.send('response-received');
        }
    } else {
        console.error(`Task with ID ${taskId} not found.`);
    }
});

ipcMain.on('stop-task', (event, taskId) => {
    const taskIndex = tasks.running.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        const [task] = tasks.running.splice(taskIndex, 1);
        task.timestamp = 'Just now';
        tasks.history.unshift(task);
        mainWindow.webContents.send('update-tasks', tasks);
    }
});

ipcMain.on('unfavorite-task', (event, taskId) => {
    const taskIndex = tasks.favorites.findIndex(t => t.id === taskId);
    if (taskIndex > -1) {
        const [task] = tasks.favorites.splice(taskIndex, 1);
        task.timestamp = 'Just now';
        tasks.history.unshift(task);
        mainWindow.webContents.send('update-tasks', tasks);
    }
});

const simpleGit = require('simple-git');

// ... (rest of the file)

ipcMain.on('get-status-info', async (event) => {
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
    const percentage = totalTokens / limit;

    const git = simpleGit(config.getWorkingDir());
    const branchName = (await git.branch()).current;

    const statusInfo = {
        cwd: shortenPath(tildeifyPath(config.getWorkingDir()), 70),
        sandbox: sandboxEnabled,
        model,
        contextWindow: `${((1 - percentage) * 100).toFixed(0)}%`,
        branchName,
    };
    event.sender.send('update-status-info', statusInfo);
});

ipcMain.on('navigate-to-dashboard', (event) => {
    mainWindow.loadFile('index.html');
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('update-tasks', tasks);
    });
});
