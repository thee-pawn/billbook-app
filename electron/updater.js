'use strict';

const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');
const {
  isMacRunFromDiskImage,
  waitForNativeSquirrelReady,
  showDiskImageWarningOnce,
} = require('./updater-mac-helpers');

// ── Configuration ────────────────────────────────────────────────────────────

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_CHECK_FILE = 'last-update-check.json';

let hourlyTimer = null;
let updatingWindow = null;
let stopBackendFn = null;

function setStopBackend(fn) {
  stopBackendFn = fn;
}

// ── Cooldown helpers ─────────────────────────────────────────────────────────

function getLastCheckFile() {
  return path.join(app.getPath('userData'), LAST_CHECK_FILE);
}

function getLastCheckTime() {
  try {
    const file = getLastCheckFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return typeof data.lastCheck === 'number' ? data.lastCheck : 0;
    }
  } catch { /* treat as never checked */ }
  return 0;
}

function saveLastCheckTime() {
  try {
    fs.writeFileSync(
      getLastCheckFile(),
      JSON.stringify({ lastCheck: Date.now(), checkedAt: new Date().toISOString() }),
      'utf-8',
    );
  } catch (err) {
    log.warn('[Updater] Could not persist last-check timestamp:', err);
  }
}

function isWithinCooldown() {
  return Date.now() - getLastCheckTime() < UPDATE_CHECK_INTERVAL_MS;
}

// ── Updating window ──────────────────────────────────────────────────────────

function createUpdatingWindow() {
  if (updatingWindow && !updatingWindow.isDestroyed()) return updatingWindow;

  updatingWindow = new BrowserWindow({
    width: 480,
    height: 340,
    resizable: false,
    frame: false,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'updating-preload.js'),
    },
  });

  updatingWindow.loadFile(path.join(__dirname, 'updating.html'));
  updatingWindow.once('ready-to-show', () => {
    if (updatingWindow && !updatingWindow.isDestroyed()) updatingWindow.show();
  });
  updatingWindow.on('closed', () => { updatingWindow = null; });
  return updatingWindow;
}

function sendToUpdatingWindow(channel, data) {
  if (updatingWindow && !updatingWindow.isDestroyed()) {
    updatingWindow.webContents.send(channel, data);
  }
}

function closeUpdatingWindow() {
  if (updatingWindow && !updatingWindow.isDestroyed()) {
    updatingWindow.close();
    updatingWindow = null;
  }
}

// ── Core: quit-and-install with proper cleanup ───────────────────────────────

async function performQuitAndInstall() {
  log.info('[Updater] Performing quit-and-install…');
  sendToUpdatingWindow('update:status', 'Installing update…');

  if (typeof stopBackendFn === 'function') {
    sendToUpdatingWindow('update:status', 'Stopping services…');
    try {
      await stopBackendFn();
    } catch (err) {
      log.warn('[Updater] stopBackend error (continuing):', err);
    }
  }

  sendToUpdatingWindow('update:status', 'Restarting…');

  // Small delay so the user sees the "Restarting…" status
  await new Promise((r) => setTimeout(r, 500));

  global.__billbookQuitForUpdate = true;

  const runQuitAndInstall = () => {
    try {
      if (process.platform === 'darwin') {
        autoUpdater.quitAndInstall();
      } else {
        // NSIS: isSilent=true so it runs /S, isForceRunAfter=true to relaunch
        autoUpdater.quitAndInstall(true, true);
      }
    } catch (err) {
      log.error('[Updater] quitAndInstall threw:', err);
      global.__billbookQuitForUpdate = false;
    }
  };

  if (process.platform === 'darwin') {
    // Squirrel.Mac / ShipIt needs a beat before the swap
    setTimeout(runQuitAndInstall, 1800);
  } else {
    setImmediate(runQuitAndInstall);
  }

  // Fallback: force exit if the process is still alive
  setTimeout(() => {
    if (global.__billbookQuitForUpdate) {
      log.warn('[Updater] Fallback exit — process still alive after quitAndInstall');
      global.__billbookQuitForUpdate = false;
      app.exit(0);
    }
  }, process.platform === 'darwin' ? 8000 : 10000);
}

// ── Startup update check ─────────────────────────────────────────────────────
// Called once before the main window opens. If an update is already downloaded
// or downloads quickly, it installs immediately. Otherwise the app proceeds.

function checkOnStartup() {
  if (!app.isPackaged) {
    log.info('[Updater] Development mode — skipping startup update check.');
    return Promise.resolve(false);
  }

  if (isMacRunFromDiskImage()) {
    log.warn('[Updater] Running from disk image — skipping update.');
    showDiskImageWarningOnce(app, dialog, log);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (willUpdate) => {
      if (settled) return;
      settled = true;
      saveLastCheckTime();
      resolve(willUpdate);
    };

    // Timeout: if nothing resolves in 30s, continue to the app
    const startupTimeout = setTimeout(() => {
      log.info('[Updater] Startup check timed out — proceeding to app.');
      finish(false);
    }, 30000);

    const cleanup = () => {
      clearTimeout(startupTimeout);
      autoUpdater.removeAllListeners('update-not-available');
      autoUpdater.removeAllListeners('update-available');
      autoUpdater.removeAllListeners('update-downloaded');
      autoUpdater.removeAllListeners('download-progress');
      autoUpdater.removeAllListeners('error');
    };

    autoUpdater.once('update-not-available', () => {
      log.info('[Updater] App is up to date.');
      cleanup();
      finish(false);
    });

    autoUpdater.once('error', (err) => {
      log.error('[Updater] Startup check error:', err.message || err);
      cleanup();
      finish(false);
    });

    autoUpdater.once('update-available', (info) => {
      log.info(`[Updater] Update available: v${info.version}. Downloading…`);
      // Show the updating window while downloading
      createUpdatingWindow();
      sendToUpdatingWindow('update:status', `Downloading v${info.version}…`);
    });

    autoUpdater.on('download-progress', (progress) => {
      const pct = Math.round(progress.percent);
      log.info(`[Updater] Downloading… ${pct}%`);
      sendToUpdatingWindow('update:progress', {
        percent: pct,
        message: `Downloading update… ${pct}%`,
      });
    });

    autoUpdater.once('update-downloaded', async (info) => {
      log.info(`[Updater] v${info.version} downloaded.`);
      cleanup();

      // Ensure the updating window is visible
      if (!updatingWindow || updatingWindow.isDestroyed()) {
        createUpdatingWindow();
      }
      sendToUpdatingWindow('update:progress', { percent: 100, message: 'Download complete.' });
      sendToUpdatingWindow('update:status', 'Preparing to install…');

      // macOS: wait for native Squirrel to ingest the ZIP
      if (process.platform === 'darwin') {
        sendToUpdatingWindow('update:status', 'Finalizing update…');
        await waitForNativeSquirrelReady(electron, log);
      }

      log.info(`[Updater] Installing v${info.version} on startup…`);
      finish(true);
      await performQuitAndInstall();
    });

    log.info('[Updater] Starting startup update check…');
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[Updater] checkForUpdates() threw:', err.message || err);
      cleanup();
      finish(false);
    });
  });
}

// ── Background update check (while app is running) ───────────────────────────

function checkInBackground() {
  if (!app.isPackaged) return Promise.resolve();

  if (isMacRunFromDiskImage()) return Promise.resolve();

  if (isWithinCooldown()) {
    const ageMin = Math.round((Date.now() - getLastCheckTime()) / 60000);
    log.info(`[Updater] Cooldown active (${ageMin} min ago) — skipping.`);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) { settled = true; saveLastCheckTime(); resolve(); }
    };

    autoUpdater.once('update-not-available', () => {
      log.info('[Updater] App is up to date (background check).');
      finish();
    });

    autoUpdater.once('error', (err) => {
      log.error('[Updater] Background check error:', err.message || err);
      finish();
    });

    autoUpdater.once('update-available', (info) => {
      log.info(`[Updater] Background: update v${info.version} available, downloading…`);
      finish();
    });

    autoUpdater.on('download-progress', (progress) => {
      log.info(`[Updater] Background downloading… ${Math.round(progress.percent)}%`);
    });

    autoUpdater.once('update-downloaded', async (info) => {
      log.info(`[Updater] Background: v${info.version} downloaded. Prompting user…`);

      if (process.platform === 'darwin') {
        await waitForNativeSquirrelReady(electron, log);
      }

      const parent =
        BrowserWindow.getFocusedWindow() ||
        BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

      const laterHint = process.platform === 'darwin'
        ? 'If you choose Later, fully quit with ⌘Q (BillBookPlus menu → Quit). ' +
          'Closing only the main window leaves the app running, so the update will not install.\n\n' +
          'If Restart Now still fails, ensure BillBookPlus is in Applications.'
        : 'Restart now to apply the update, or choose Later and quit the app when you are ready.';

      const box = {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded and is ready to install.`,
        detail: laterHint,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      };

      const { response } = parent
        ? await dialog.showMessageBox(parent, box)
        : await dialog.showMessageBox(box);

      if (response === 0) {
        log.info('[Updater] User chose Restart Now');
        createUpdatingWindow();
        sendToUpdatingWindow('update:status', 'Installing update…');
        await performQuitAndInstall();
      } else {
        log.info('[Updater] User chose to update later.');
      }
    });

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[Updater] checkForUpdates() threw:', err.message || err);
      finish();
    });
  });
}

// ── Periodic checks ──────────────────────────────────────────────────────────

function startPeriodicChecks() {
  if (hourlyTimer) return;
  hourlyTimer = setInterval(() => {
    checkInBackground().catch((err) =>
      log.warn('[Updater] Periodic check error:', err),
    );
  }, UPDATE_CHECK_INTERVAL_MS);
  if (hourlyTimer.unref) hourlyTimer.unref();
  log.info('[Updater] Hourly background checks started.');
}

function stopPeriodicChecks() {
  if (hourlyTimer) {
    clearInterval(hourlyTimer);
    hourlyTimer = null;
    log.info('[Updater] Hourly background checks stopped.');
  }
}

// ── Manual check (from renderer IPC) ─────────────────────────────────────────

function checkForUpdatesManual() {
  return checkInBackground();
}

module.exports = {
  checkOnStartup,
  checkInBackground,
  checkForUpdatesManual,
  startPeriodicChecks,
  stopPeriodicChecks,
  setStopBackend,
  closeUpdatingWindow,
};
