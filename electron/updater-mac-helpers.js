'use strict';

/**
 * macOS auto-update gotchas (electron-builder + electron-updater MacUpdater):
 *
 * 1) MacUpdater dispatches JS "update-downloaded" BEFORE Squirrel.Mac finishes
 *    pulling the update via the local proxy. quitAndInstall() must run only after
 *    Electron's native autoUpdater fires "update-downloaded" (Squirrel ready).
 *
 * 2) Updates cannot replace the app bundle when running from a mounted .dmg
 *    (execPath under /Volumes/). Skip checks and tell the user once.
 */

const fs = require('fs');
const path = require('path');

const DMG_WARNING_FLAG = '.billbook_dmg_update_warning_shown';

function isMacRunFromDiskImage() {
  if (process.platform !== 'darwin') return false;
  try {
    return process.execPath.includes('/Volumes/');
  } catch {
    return false;
  }
}

/**
 * Wait until Squirrel.Mac has the update (Electron native autoUpdater event),
 * or timeout so we never block forever.
 */
function waitForNativeSquirrelReady(electronModule, log, timeoutMs = 20000) {
  if (process.platform !== 'darwin') {
    return Promise.resolve();
  }
  const nativeAu = electronModule.autoUpdater;
  if (!nativeAu || typeof nativeAu.once !== 'function') {
    log.warn('[Updater] Native autoUpdater missing — skipping Squirrel wait');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(failSafe);
      log.info(`[Updater] Native Squirrel wait finished (${reason})`);
      resolve();
    };
    nativeAu.once('update-downloaded', () => finish('native update-downloaded'));
    const failSafe = setTimeout(() => finish('timeout'), timeoutMs);
  });
}

function showDiskImageWarningOnce(app, dialog, log) {
  const flag = path.join(app.getPath('userData'), DMG_WARNING_FLAG);
  if (fs.existsSync(flag)) return;
  try {
    fs.writeFileSync(flag, new Date().toISOString(), 'utf8');
  } catch (e) {
    log.warn('[Updater] Could not write DMG notice flag:', e.message);
  }
  try {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Move BillBookPlus to Applications',
      message: 'Automatic updates only install when BillBookPlus runs from the Applications folder.',
      detail:
        'You are running from a disk image or external volume. Quit, drag BillBookPlus into Applications, eject the disk image if needed, then open it from Applications. After that, updates will install when you restart.',
    });
  } catch (e) {
    log.warn('[Updater] DMG dialog failed:', e.message);
  }
}

module.exports = {
  isMacRunFromDiskImage,
  waitForNativeSquirrelReady,
  showDiskImageWarningOnce,
};
