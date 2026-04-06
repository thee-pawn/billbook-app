'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe API to the setup window renderer.
contextBridge.exposeInMainWorld('setup', {
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, msg) => cb(msg)),
  onComplete: (cb) => ipcRenderer.on('setup:complete', () => cb()),
  onError:    (cb) => ipcRenderer.on('setup:error', (_e, err) => cb(err)),
});
