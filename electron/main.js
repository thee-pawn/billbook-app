'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const log = require('electron-log');
const { checkForUpdates } = require('./updater');
const { startBackend, stopBackend } = require('./backend');
const { needsSetup, ensurePlaywrightBrowsers } = require('./setup');

let mainWindow = null;

/**
 * macOS "About" reads Info.plist by default; if CFBundle* was wrong at pack time,
 * the panel shows stale numbers. Align it with the root package.json bundled in the app.
 */
function syncAboutPanelFromPackageJson() {
  if (process.platform !== 'darwin') return;
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const v = pkg.version || app.getVersion();
    app.setAboutPanelOptions({
      applicationName: 'BillBookPlus',
      applicationVersion: v,
      version: v,
      copyright: `Copyright © ${new Date().getFullYear()} BillBook Team`,
    });
  } catch (err) {
    log.warn('[Main] syncAboutPanelFromPackageJson:', err.message);
  }
}

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
 * Shown when dependencies are missing or incomplete; skipped when everything is ready.
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

      ensurePlaywrightBrowsers((msg) => {
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
  syncAboutPanelFromPackageJson();

  // Step 1 — Dependency setup: verify Node runtime (embedded when packaged),
  //           bundled Playwright, then download Chromium if needed.
  if (needsSetup()) {
    log.info('[Main] Setup required — checking runtime and Playwright browsers.');
    await runFirstTimeSetup();
  }

  // Step 2 — Start the WhatsApp automation backend child process.
  await startBackend();

  // Step 3 — Open the main window (do not wait for update download).
  createMainWindow();

  // Step 4 — Check / download updates in the background; prompt when ready to install.
  checkForUpdates().catch((err) =>
    log.error('[Main] checkForUpdates failed:', err?.message ?? err),
  );

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
  } else if (global.__billbookQuitForUpdate) {
    // quitAndInstall() closes windows first; on macOS we normally do NOT quit when the
    // last window closes (app stays in Dock). Without this, the process never exits and
    // Squirrel.Mac cannot apply the update — "Restart Now" appears to do nothing.
    global.__billbookQuitForUpdate = false;
    app.quit();
  }
});
