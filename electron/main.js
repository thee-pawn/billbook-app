'use strict';

const { app, BrowserWindow, screen } = require('electron');
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

// Match V2 main: layout targets ~1280px width; scale down in smaller windows.
const MAIN_CONTENT_BASELINE_WIDTH = 1280;
const MAIN_ZOOM_MIN = 0.5;
const MAIN_ZOOM_MAX = 1;

function getDefaultMainWindowSize() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const margin = 32;
  const preferredW = 1200;
  const preferredH = 800;
  return {
    width: Math.max(900, Math.min(preferredW, workAreaSize.width - margin)),
    height: Math.max(560, Math.min(preferredH, workAreaSize.height - margin)),
  };
}

function getMainWindowContentZoomFactor(win) {
  const cw = win.getContentBounds().width;
  if (cw <= 0) return 1;
  const factor = cw / MAIN_CONTENT_BASELINE_WIDTH;
  return Math.max(MAIN_ZOOM_MIN, Math.min(MAIN_ZOOM_MAX, factor));
}

function applyMainWindowContentZoom(win) {
  if (win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isDestroyed()) return;
  try {
    wc.setZoomFactor(getMainWindowContentZoomFactor(win));
  } catch {
    // ignore
  }
}

function attachAdaptiveContentZoom(win) {
  let resizeTimer;
  const apply = () => applyMainWindowContentZoom(win);
  const scheduleResize = () => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 48);
  };
  win.on('resize', scheduleResize);
  win.webContents.on('did-finish-load', apply);
  win.once('ready-to-show', () => setTimeout(apply, 0));
}

// ── Main application window ───────────────────────────────────────────────────

function createMainWindow() {
  const { width, height } = getDefaultMainWindowSize();
  mainWindow = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  attachAdaptiveContentZoom(mainWindow);

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
    return;
  }
  // macOS: by default the app stays open in the Dock with no windows, so the process
  // never exits and Squirrel cannot finish. After "Restart Now" we set
  // __billbookQuitForUpdate — defer app.quit() so native quitAndInstall / ShipIt gets a
  // head start (immediate quit was racing the swap; no quit at all = "nothing happens").
  if (global.__billbookQuitForUpdate) {
    const doQuit = () => {
      global.__billbookQuitForUpdate = false;
      log.info('[Main] app.quit() after update (deferred, darwin)');
      app.quit();
    };
    setTimeout(doQuit, 2000);
  }
});
