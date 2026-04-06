'use strict';

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const log = require('electron-log');

let backendProcess = null;

/**
 * Spawns the WhatsApp automation backend as a child process.
 *
 * Packaged mode:  uses process.execPath (the Electron binary) with
 *                 ELECTRON_RUN_AS_NODE=1 so it acts as a plain Node runtime —
 *                 no Node.js installation required on the end-user's machine.
 *
 * Development:    uses the local `node` binary for simplicity.
 *
 * Returns a Promise that resolves after 1 500 ms to give the server time to
 * bind its port before the window loads.
 */
function startBackend() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'dist', 'server.js')
    : path.join(__dirname, '../../whatsapp_automation/dist', 'server.js');

  // Directory that contains playwright/playwright-core node_modules in the
  // packaged app (copied there via extraResources in electron-builder.yml).
  const nodeModulesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'node_modules')
    : path.join(__dirname, '../../whatsapp_automation/node_modules');

  // Playwright browser binaries are downloaded on first launch by setup.js
  // into the app's userData folder — same path used here so the backend finds them.
  const playwrightBrowsersPath = path.join(app.getPath('userData'), 'playwright-browsers');

  const nodeBin = app.isPackaged ? process.execPath : 'node';

  log.info(`[Backend] Starting: ${nodeBin} ${serverPath}`);

  backendProcess = spawn(nodeBin, [serverPath], {
    env: {
      ...process.env,
      // Tell Electron to behave as a plain Node runtime when packaged.
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '4242',
      NODE_ENV: 'production',
      // Let require() resolve playwright from the bundled node_modules.
      NODE_PATH: nodeModulesPath,
      // Playwright will look here for browser binaries (downloads on first run).
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
      // Use the app's userData folder for WhatsApp session storage.
      USER_DATA_DIR: path.join(app.getPath('userData'), 'session_data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (data) => {
    log.info(`[Backend] ${data.toString().trimEnd()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    log.warn(`[Backend] ${data.toString().trimEnd()}`);
  });

  backendProcess.on('exit', (code, signal) => {
    log.info(`[Backend] Process exited — code: ${code}, signal: ${signal}`);
    backendProcess = null;
  });

  backendProcess.on('error', (err) => {
    log.error('[Backend] Failed to start process:', err.message);
  });

  // Give the server 1.5 s to bind the port before the window opens.
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

/**
 * Gracefully terminates the backend child process.
 * Called before the app quits.
 */
function stopBackend() {
  if (backendProcess) {
    log.info('[Backend] Stopping backend process…');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

module.exports = { startBackend, stopBackend };
