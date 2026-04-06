'use strict';

const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const log = require('electron-log');

// Route electron-updater logs to the same log file as the rest of the app.
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Download silently in the background; prompt on completion.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Checks for updates and resolves when the app is ready to continue loading.
 *
 * - Dev mode (not packaged) → resolves immediately (electron-updater skips
 *   silently and fires no events, so we short-circuit to avoid a hang).
 * - No update available  → resolves immediately.
 * - Error during check   → logs the error and resolves so startup isn't blocked.
 * - Update available     → logs and lets the download proceed in the background.
 * - Update downloaded    → shows a dialog; user can restart now or defer.
 */
function checkForUpdates() {
  const { app } = require('electron');

  if (!app.isPackaged) {
    log.info('[Updater] Development mode — skipping update check.');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    autoUpdater.on('update-not-available', () => {
      log.info('[Updater] App is up to date.');
      resolve();
    });

    autoUpdater.on('error', (err) => {
      log.error('[Updater] Error checking for updates:', err.message || err);
      // Never block startup on an update error.
      resolve();
    });

    autoUpdater.on('update-available', (info) => {
      log.info(`[Updater] Update available: v${info.version}. Download starting…`);
    });

    autoUpdater.on('download-progress', (progress) => {
      log.info(
        `[Updater] Downloading… ${Math.round(progress.percent)}%` +
          ` (${(progress.bytesPerSecond / 1024).toFixed(1)} KB/s)`
      );
    });

    autoUpdater.on('update-downloaded', async (info) => {
      log.info(`[Updater] v${info.version} downloaded. Prompting user…`);

      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded and is ready to install.`,
        detail: 'Restart now to apply the update, or continue and it will be applied on the next launch.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response === 0) {
        autoUpdater.quitAndInstall();
      } else {
        log.info('[Updater] User chose to update later.');
        resolve();
      }
    });

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[Updater] checkForUpdates() threw:', err.message || err);
      resolve();
    });
  });
}

module.exports = { checkForUpdates };
