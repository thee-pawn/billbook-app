'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loading', {
  onReady:    (cb) => ipcRenderer.on('loading:ready',  (_e)    => cb()),
  onStatus:   (cb) => ipcRenderer.on('loading:status', (_e, m) => cb(m)),
  getVersion: (cb) => ipcRenderer.invoke('loading:version').then(cb),
});
