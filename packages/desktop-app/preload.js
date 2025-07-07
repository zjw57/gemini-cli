const { ipcRenderer } = require('electron');

window.ipcRenderer = {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, func) => {
    // Ensure we don't add duplicate listeners
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  }
};