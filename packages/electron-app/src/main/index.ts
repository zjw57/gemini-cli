/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'
const iconPath = join(__dirname, '../../src/resources/icon.png');

// Helper to determine if a color is light or dark
function isColorLight(hexColor: string) {
  const color = hexColor.substring(1); // remove #
  const rgb = parseInt(color, 16);   // convert rrggbb to decimal
  const r = (rgb >> 16) & 0xff;  // extract red
  const g = (rgb >>  8) & 0xff;  // extract green
  const b = (rgb >>  0) & 0xff;  // extract blue

  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b; // per ITU-R BT.709

  return luma > 128;
}

function getThemeFromSettings() {
  try {
    const settingsPath = join(os.homedir(), '.gemini', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.theme && typeof settings.theme === 'object') {
        return settings.theme;
      }
    }
  } catch (error) {
    console.error('Error reading theme from settings.json:', error);
  }
  return null;
}

function createWindow() {
  const cliTheme = getThemeFromSettings();
  const isLightTheme = cliTheme ? isColorLight(cliTheme.background) : false;

  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Gemini CLI',
    icon: iconPath,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    backgroundColor: isLightTheme ? '#ffffff' : '#282a36',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const ptyProcess = pty.spawn(shell, ['-c', 'node ../../packages/cli/dist/index.js --launch-electron'], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env
  })

  ptyProcess.onData(data => {
    mainWindow.webContents.send('terminal.incomingData', data)
  })

  ipcMain.on('terminal.keystroke', (_event, key) => {
    ptyProcess.write(key)
  })

  ipcMain.on('terminal.resize', (_event, size: { cols: number; rows: number }) => {
    console.log(`Resizing terminal to ${size.cols}x${size.rows}`);
    ptyProcess.resize(size.cols, size.rows);
  });

  ipcMain.on('theme:set', (_event, theme: 'light' | 'dark') => {
    const backgroundColor = theme === 'dark' ? '#282a36' : '#ffffff';
    mainWindow.setBackgroundColor(backgroundColor);
  });

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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
