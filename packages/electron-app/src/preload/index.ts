/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  onMainWindowResize: (
    callback: (
      event: IpcRendererEvent,
      data: { width: number; height: number },
    ) => void,
  ) => {
    const channel = 'main-window-resize';
    ipcRenderer.on(channel, callback);
    return () => {
      ipcRenderer.removeListener(channel, callback);
    };
  },
  terminal: {
    onData: (callback: (event: IpcRendererEvent, data: string) => void) =>
      ipcRenderer.on('terminal.incomingData', callback),
    sendKey: (key: string) => ipcRenderer.send('terminal.keystroke', key),
    resize: (size: { cols: number; rows: number }) =>
      ipcRenderer.send('terminal.resize', size),
    onReset: (callback: (event: IpcRendererEvent) => void) =>
      ipcRenderer.on('terminal.reset', callback),
  },
  theme: {
    set: (theme: 'light' | 'dark') => ipcRenderer.send('theme:set', theme),
    onInit: (
      callback: (
        event: IpcRendererEvent,
        theme: Record<string, string>,
      ) => void,
    ) => ipcRenderer.on('theme:init', callback),
  },
  themes: {
    get: () => ipcRenderer.invoke('themes:get'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: { changes: Record<string, unknown>; scope?: string }) =>
      ipcRenderer.invoke('settings:set', settings),
  },
});
