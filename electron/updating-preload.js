'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onStatus:   (cb) => ipcRenderer.on('update:status', (_e, msg) => cb(msg)),
  onError:    (cb) => ipcRenderer.on('update:error', (_e, err) => cb(err)),
});
