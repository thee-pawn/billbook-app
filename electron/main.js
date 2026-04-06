'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const log = require('electron-log');
const { checkForUpdates } = require('./updater');
const { startBackend, stopBackend } = require('./backend');
const { isSetupComplete, installBrowsers } = require('./setup');

let mainWindow = null;

// ── Main application window ───────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In packaged mode the frontend is copied to resources/frontend/ via extraResources.
  // In development point directly at the Vite build output.
  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend', 'index.html')
    : path.join(__dirname, '../../billbook-fe/dist', 'index.html');

  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── First-run setup window ────────────────────────────────────────────────────

/**
 * Shows a frameless setup window that downloads Playwright's Chromium binary.
 * Resolves once the download finishes (or fails — startup is never blocked).
 * This window is shown exactly once; subsequent launches skip straight to the app.
 */
function runFirstTimeSetup() {
  return new Promise((resolve) => {
    const setupWindow = new BrowserWindow({
      width: 480,
      height: 340,
      resizable: false,
      frame: false,
      center: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'setup-preload.js'),
      },
    });

    setupWindow.loadFile(path.join(__dirname, 'setup.html'));

    setupWindow.once('ready-to-show', () => {
      setupWindow.show();

      installBrowsers((msg) => {
        // Forward each output line to the renderer for display.
        if (!setupWindow.isDestroyed()) {
          setupWindow.webContents.send('setup:progress', msg);
        }
      })
        .then(() => {
          if (!setupWindow.isDestroyed()) {
            setupWindow.webContents.send('setup:complete');
          }
          // Brief pause so the user sees "Setup complete!" before the window closes.
          setTimeout(() => {
            if (!setupWindow.isDestroyed()) setupWindow.close();
            resolve();
          }, 1400);
        })
        .catch((err) => {
          log.error('[Setup] Browser install failed:', err.message);
          if (!setupWindow.isDestroyed()) {
            setupWindow.webContents.send('setup:error', err.message);
          }
          // Give the user a moment to read the error, then continue anyway.
          // The setup window will appear again on the next launch to retry.
          setTimeout(() => {
            if (!setupWindow.isDestroyed()) setupWindow.close();
            resolve();
          }, 5000);
        });
    });
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Step 1 — First-time setup: download browser binaries (skipped on every
  //           subsequent launch once the marker file exists).
  if (!isSetupComplete()) {
    log.info('[Main] First launch detected — running setup.');
    await runFirstTimeSetup();
  }

  // Step 2 — Check for app updates (resolves immediately if none / on error).
  await checkForUpdates();

  // Step 3 — Start the WhatsApp automation backend child process.
  await startBackend();

  // Step 4 — Open the main window.
  createMainWindow();

  // macOS: recreate window when dock icon is clicked and no windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
