'use strict';

const { autoUpdater } = require('electron-updater');
const { dialog, app, BrowserWindow } = require('electron');
const log = require('electron-log');

// Route electron-updater logs to the same log file as the rest of the app.
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;

// Download silently in the background; prompt on completion.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function laterInstallHint() {
  if (process.platform === 'darwin') {
    return (
      'If you choose Later, quit with ⌘Q (BillBook menu → Quit). Closing only the main window leaves the app running, so the update will not install.\n\n' +
      'If Restart Now does nothing, drag BillBook into Applications first — updates cannot replace an app run directly from the installer disk image.'
    );
  }
  return 'Restart now to apply the update, or choose Later and quit the app when you are ready.';
}

/**
 * Checks for updates without blocking the UI.
 *
 * - Dev mode (not packaged) → resolves immediately.
 * - No update / error on check → resolves once the metadata request completes.
 * - Update available → resolves as soon as we know (download continues in background).
 * - Update downloaded → shows a dialog (after the main window may already be open).
 */
function checkForUpdates() {
  if (!app.isPackaged) {
    log.info('[Updater] Development mode — skipping update check.');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    autoUpdater.once('update-not-available', () => {
      log.info('[Updater] App is up to date.');
      finish();
    });

    autoUpdater.once('error', (err) => {
      log.error('[Updater] Error checking for updates:', err.message || err);
      finish();
    });

    autoUpdater.once('update-available', (info) => {
      log.info(`[Updater] Update available: v${info.version}. Download in background…`);
      finish(); // do not wait for download — startup / UI continues
    });

    autoUpdater.on('download-progress', (progress) => {
      log.info(
        `[Updater] Downloading… ${Math.round(progress.percent)}%` +
          ` (${(progress.bytesPerSecond / 1024).toFixed(1)} KB/s)`
      );
    });

    autoUpdater.once('update-downloaded', async (info) => {
      log.info(`[Updater] v${info.version} downloaded. Prompting user…`);

      const parent =
        BrowserWindow.getFocusedWindow() ||
        BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

      const box = {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded and is ready to install.`,
        detail: laterInstallHint(),
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      };

      const { response } = parent
        ? await dialog.showMessageBox(parent, box)
        : await dialog.showMessageBox(box);

      if (response === 0) {
        log.info('[Updater] User chose Restart Now');
        global.__billbookQuitForUpdate = true;

        const scheduleQuitAndInstall = () => {
          try {
            autoUpdater.quitAndInstall(true, true);
          } catch (err) {
            log.error('[Updater] quitAndInstall threw:', err);
            global.__billbookQuitForUpdate = false;
          }
        };

        // macOS Squirrel: wait for native "update-downloaded" before quitAndInstall;
        // 700ms was often too short in practice.
        if (process.platform === 'darwin') {
          setTimeout(scheduleQuitAndInstall, 1800);
        } else {
          setImmediate(scheduleQuitAndInstall);
        }

        // Windows/Linux: NSIS may fail to exit — force quit after delay.
        if (process.platform !== 'darwin') {
          setTimeout(() => {
            if (!app.isQuitting) {
              log.warn('[Updater] Fallback app.quit() — installer did not exit the process');
              app.quit();
            }
          }, 8000);
        }

        // macOS: if Dock keeps the process alive (no app.quit() after windows close), exit later.
        if (process.platform === 'darwin') {
          setTimeout(() => {
            if (global.__billbookQuitForUpdate && !app.isQuitting) {
              log.warn('[Updater] macOS fallback app.quit() — still running after restart');
              global.__billbookQuitForUpdate = false;
              app.quit();
            }
          }, 6000);
        }
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

module.exports = { checkForUpdates };
