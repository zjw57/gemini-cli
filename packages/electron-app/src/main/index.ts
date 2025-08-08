/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import * as pty from 'node-pty';
import os from 'os';

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const iconPath = join(__dirname, '../../src/resources/icon.png');
let ptyProcess: pty.IPty | null = null;
let ptyOnDataDisposable: pty.IDisposable | null = null;

async function startPtyProcess(mainWindow: BrowserWindow) {
  if (ptyOnDataDisposable) {
    ptyOnDataDisposable.dispose();
    ptyOnDataDisposable = null;
  }

  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  mainWindow.webContents.send('terminal.reset');

  ptyProcess = pty.spawn(
    shell,
    ['-c', 'node ../../packages/cli/dist/index.js --launch-electron'],
    {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env,
    },
  );

  ptyOnDataDisposable = ptyProcess.onData((data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal.incomingData', data);
    }
  });
}

async function getThemeFromSettings() {
  const { loadSettings } = await import(
    '@google/gemini-cli/dist/src/config/settings.js'
  );
  const { themeManager } = await import(
    '@google/gemini-cli/dist/src/ui/themes/theme-manager.js'
  );
  const { merged: settings } = await loadSettings(process.cwd());
  const themeName = settings.theme;
  if (!themeName) {
    return undefined;
  }

  themeManager.loadCustomThemes(settings.customThemes);
  return themeManager.getTheme(themeName);
}

function isObject(item: unknown): item is Record<string, unknown> {
  return !!(item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge<T extends object, U extends object>(
  target: T,
  source: U,
): T & U {
  const output = { ...target } as T & U;

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      const sourceKey = key as keyof U;
      const targetKey = key as keyof T;
      if (isObject(source[sourceKey])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[sourceKey] });
        } else {
          output[targetKey] = deepMerge(
            target[targetKey] as object,
            source[sourceKey] as object,
          );
        }
      } else {
        Object.assign(output, { [key]: source[sourceKey] });
      }
    });
  }

  return output;
}

async function createWindow() {
  const cliTheme = await getThemeFromSettings();
  let prevResize = [0, 0];

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'Gemini CLI',
    icon: iconPath,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    backgroundColor: cliTheme ? cliTheme.colors.Background : '#282a36',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  startPtyProcess(mainWindow);

  mainWindow.on('closed', () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getContentSize();
    mainWindow.webContents.send('main-window-resize', { width, height });
  });

  ipcMain.on('terminal.keystroke', (_event, key) => {
    ptyProcess?.write(key);
  });

  ipcMain.on(
    'terminal.resize',
    (_event, size: { cols: number; rows: number }) => {
      if (size.cols !== prevResize[0] || size.rows !== prevResize[1]) {
        console.log(`Resizing terminal to ${size.cols}x${size.rows}`);
        ptyProcess?.resize(size.cols, size.rows);
        prevResize = [size.cols, size.rows];
      }
    },
  );

  ipcMain.on('theme:set', (_event, theme: 'light' | 'dark') => {
    const backgroundColor = theme === 'dark' ? '#282a36' : '#ffffff';
    mainWindow.setBackgroundColor(backgroundColor);
  });

  ipcMain.handle('settings:get', async () => {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const settings = loadSettings(process.cwd());
    // We need to convert the class instance to a plain object to send over IPC
    // so that the `merged` getter is resolved.
    return {
      system: settings.system,
      user: settings.user,
      workspace: settings.workspace,
      errors: settings.errors,
      merged: settings.merged,
    };
  });

  ipcMain.handle('themes:get', async () => {
    const { loadSettings } = await import(
      '@google/gemini-cli/dist/src/config/settings.js'
    );
    const { themeManager } = await import(
      '@google/gemini-cli/dist/src/ui/themes/theme-manager.js'
    );
    const { merged: settings } = await loadSettings(process.cwd());
    themeManager.loadCustomThemes(settings.customThemes);
    return themeManager.getAvailableThemes();
  });

  ipcMain.handle(
    'settings:set',
    async (_event, { changes, scope = 'User' }) => {
      const { loadSettings, saveSettings, SettingScope } = await import(
        '@google/gemini-cli/dist/src/config/settings.js'
      );
      try {
        const loadedSettings = await loadSettings(process.cwd());

        let scopeEnum: SettingScope;
        if (scope === 'Workspace') {
          scopeEnum = SettingScope.Workspace;
        } else if (scope === 'System') {
          scopeEnum = SettingScope.System;
        } else {
          scopeEnum = SettingScope.User;
        }

        const settingsFile = loadedSettings.forScope(scopeEnum);

        // Create a mutable copy of the settings
        const newSettings = { ...settingsFile.settings };

        // When updating mcpServers, we want to replace the whole object, not merge it,
        // to ensure deletions are persisted.
        if (changes.mcpServers) {
          newSettings.mcpServers = changes.mcpServers;
          delete changes.mcpServers;
        }

        const mergedSettings = deepMerge(newSettings, changes);

        saveSettings({ path: settingsFile.path, settings: mergedSettings });

        // Re-read theme and update main window
        const newTheme = await getThemeFromSettings();
        if (newTheme) {
          mainWindow.webContents.send('theme:init', newTheme);
          mainWindow.setBackgroundColor(newTheme.colors.Background);
        }
        startPtyProcess(mainWindow);
        return { success: true };
      } catch (error) {
        console.error('Error writing settings.json:', error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  // Send theme to renderer process
  mainWindow.webContents.on('did-finish-load', () => {
    if (cliTheme) {
      mainWindow.webContents.send('theme:init', cliTheme);
    }
  });
}

app.whenReady().then(() => {
  if (os.platform() === 'darwin') {
    app.dock.setIcon(iconPath);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (ptyOnDataDisposable) {
    ptyOnDataDisposable.dispose();
    ptyOnDataDisposable = null;
  }
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
