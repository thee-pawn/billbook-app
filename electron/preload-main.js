'use strict';

/**
 * Main-window preload: exposes the actual WhatsApp backend TCP port chosen at
 * runtime (may differ from 4242 when that port is already in use on Windows).
 * billbook-fe/src/apis/whatsappApi.js reads window.__ELECTRON_CONFIG__.backendPort.
 */
const { contextBridge, ipcRenderer } = require('electron');

try {
  const backendPort = ipcRenderer.sendSync('billbook:get-backend-port');
  const n = typeof backendPort === 'number' ? backendPort : parseInt(String(backendPort), 10);
  contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', {
    backendPort: Number.isFinite(n) && n > 0 ? n : 4242,
  });
} catch {
  contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', { backendPort: 4242 });
}
