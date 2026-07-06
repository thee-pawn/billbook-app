'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');

// Windows: dual Chromium (Electron + Playwright) can corrupt DWM and whiten the desktop.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}
const {
  checkOnStartup,
  checkInBackground,
  startPeriodicChecks,
  stopPeriodicChecks,
  setStopBackend,
  closeUpdatingWindow,
} = require('./updater');
const { startBackend, stopBackend, getBackendPort } = require('./backend');
const { needsSetup, ensurePlaywrightBrowsers } = require('./setup');
const { attachMainWindowZoom, getDefaultMainWindowSize } = require('./windowZoom');

let mainWindow = null;
let loadingWindow = null;

// Give the updater a reference to stopBackend so it can kill the backend
// before quitAndInstall replaces the executable.
setStopBackend(stopBackend);

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

// ── Loading / splash window ───────────────────────────────────────────────────

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    frame: false,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'loading-preload.js'),
    },
  });

  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));

  loadingWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.show();
  });

  loadingWindow.on('closed', () => { loadingWindow = null; });
}

function sendLoadingStatus(msg) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('loading:status', msg);
  }
}

function closeLoadingWindow() {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  // Signal "ready", wait briefly so the user sees the tick, then close.
  loadingWindow.webContents.send('loading:ready');
  setTimeout(() => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
  }, 600);
}

ipcMain.handle('loading:version', () => app.getVersion());

// Synchronous port for main-window preload (must run after startBackend()).
ipcMain.on('billbook:get-backend-port', (event) => {
  try {
    event.returnValue = getBackendPort();
  } catch {
    event.returnValue = 4242;
  }
});

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
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });

  attachMainWindowZoom(mainWindow);

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
        if (!setupWindow.isDestroyed()) {
          setupWindow.webContents.send('setup:progress', msg);
        }
      })
        .then(() => {
          if (!setupWindow.isDestroyed()) {
            setupWindow.webContents.send('setup:complete');
          }
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

  // Step 1 — First-run dependency setup (Playwright Chromium download).
  if (needsSetup()) {
    log.info('[Main] Setup required — checking runtime and Playwright browsers.');
    await runFirstTimeSetup();
  }

  // Step 2 — Check for app updates BEFORE starting services.
  // If an update is downloaded, it installs and restarts — we never reach Step 3.
  const willUpdate = await checkOnStartup();
  if (willUpdate) {
    log.info('[Main] Update in progress — skipping service start.');
    return;
  }

  // Close the updating window if it was briefly shown for a "no update" check.
  closeUpdatingWindow();

  // Step 3 — Show the loading screen while the backend starts.
  createLoadingWindow();
  sendLoadingStatus('Launching backend service…');

  // Step 4 — Start the WhatsApp automation backend child process.
  // startBackend() now resolves only when the server is actually ready.
  await startBackend();

  // Step 5 — Backend is up: close loading screen and open the main window.
  closeLoadingWindow();
  createMainWindow();

  // Step 6 — Start periodic background update checks (hourly).
  startPeriodicChecks();

  // macOS: recreate window when dock icon is clicked and no windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  stopPeriodicChecks();
  await stopBackend();

  if (process.platform !== 'darwin') {
    app.quit();
    return;
  }

  // macOS: after "Restart Now" the updater sets __billbookQuitForUpdate.
  // Defer app.exit() so Squirrel.Mac / ShipIt gets a head start on the swap.
  if (global.__billbookQuitForUpdate) {
    setTimeout(() => {
      global.__billbookQuitForUpdate = false;
      log.info('[Main] Deferred app.exit() after macOS update install');
      app.exit(0);
    }, 2000);
  }
});
