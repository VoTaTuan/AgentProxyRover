'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('state'),
  start: () => ipcRenderer.invoke('start'),
  stop: () => ipcRenderer.invoke('stop'),
  rotate: (itemId) => ipcRenderer.invoke('rotate', itemId),
  reload: () => ipcRenderer.invoke('reload'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  enableHotReload: () => ipcRenderer.invoke('enable-hot-reload'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
});
