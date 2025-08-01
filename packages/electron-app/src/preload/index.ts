/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  terminal: {
    onData: (callback: (event: IpcRendererEvent, data: string) => void) => ipcRenderer.on('terminal.incomingData', callback),
    sendKey: (key: string) => ipcRenderer.send('terminal.keystroke', key),
    resize: (size: { cols: number; rows: number }) => ipcRenderer.send('terminal.resize', size)
  },
  theme: {
    set: (theme: 'light' | 'dark') => ipcRenderer.send('theme:set', theme),
    onInit: (callback: (event: IpcRendererEvent, theme: Record<string, string>) => void) => ipcRenderer.on('theme:init', callback)
  }
})