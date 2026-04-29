'use strict';

const { autoUpdater } = require('electron-updater');
const { dialog, app, BrowserWindow } = require('electron');
const log = require('electron-log');

// Route electron-updater logs to the same log file as the rest of the app.
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

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
        log.info('[Updater] User chose Restart Now — quitAndInstall');
        // See electron/main.js window-all-closed (darwin): we must app.quit() after the
        // last window closes or the main process never exits and macOS updates never apply.
        global.__billbookQuitForUpdate = true;
        setImmediate(() => {
          try {
            // Windows NSIS: first arg MUST be true so the installer gets /S (silent). With
            // nsis.oneClick: false, quitAndInstall(false, …) shows the full wizard again.
            // Second arg: relaunch the app after install (--force-run). macOS updater ignores these.
            autoUpdater.quitAndInstall(true, true);
          } catch (err) {
            log.error('[Updater] quitAndInstall threw:', err);
            global.__billbookQuitForUpdate = false;
          }
          // If quitAndInstall did not start a quit (e.g. Squirrel race), force quit so the
          // staged ZIP can still install via normal exit.
          setTimeout(() => {
            const { app: electronApp } = require('electron');
            if (global.__billbookQuitForUpdate && !electronApp.isQuitting) {
              log.warn('[Updater] Fallback app.quit() — quitAndInstall did not exit the process');
              electronApp.quit();
            }
          }, 2500);
        });
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
