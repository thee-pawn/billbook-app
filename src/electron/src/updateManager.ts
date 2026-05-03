import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import electron, { dialog, app, BrowserWindow } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Production Update Manager (V2)
 *
 * Two modes of operation:
 *  1. Startup check — runs before the main window opens. If an update is
 *     downloaded, shows a branded updating window and installs immediately.
 *  2. Background checks — hourly while the app is running. Prompts the user
 *     with a dialog when an update is ready; on "Restart Now" shows the
 *     updating window and installs.
 *
 * Key fixes over V1:
 *  - Backend process is killed before quitAndInstall so the installer can
 *    replace files on both macOS and Windows.
 *  - Uses app.exit(0) as fallback instead of app.quit() to avoid being
 *    intercepted by event handlers.
 *  - Updating window provides visual feedback during install.
 */

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_CHECK_FILENAME = 'last-update-check.json';

export class UpdateManager {
  private lastCheckFile: string;
  private hourlyTimer?: NodeJS.Timeout;
  private getMainWindow: () => BrowserWindow | undefined;
  private stopBackendFn?: () => Promise<void>;
  private updatingWindow?: BrowserWindow;

  constructor(
    userDataPath: string,
    getMainWindow: () => BrowserWindow | undefined,
    stopBackendFn?: () => Promise<void>,
  ) {
    this.lastCheckFile = path.join(userDataPath, LAST_CHECK_FILENAME);
    this.getMainWindow = getMainWindow;
    this.stopBackendFn = stopBackendFn;
    this.configureUpdater();
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  private configureUpdater(): void {
    autoUpdater.logger = log;
    (autoUpdater.logger as any).transports.file.level = 'info';
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
  }

  // ─── Updating window ───────────────────────────────────────────────────────

  private createUpdatingWindow(): BrowserWindow {
    if (this.updatingWindow && !this.updatingWindow.isDestroyed()) {
      return this.updatingWindow;
    }

    this.updatingWindow = new BrowserWindow({
      width: 480,
      height: 340,
      resizable: false,
      frame: false,
      center: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', '..', 'electron', 'updating-preload.js'),
      },
    });

    this.updatingWindow.loadFile(
      path.join(__dirname, '..', '..', 'electron', 'updating.html'),
    );
    this.updatingWindow.once('ready-to-show', () => {
      if (this.updatingWindow && !this.updatingWindow.isDestroyed()) {
        this.updatingWindow.show();
      }
    });
    this.updatingWindow.on('closed', () => {
      this.updatingWindow = undefined;
    });

    return this.updatingWindow;
  }

  private sendToUpdatingWindow(channel: string, data?: object | string): void {
    if (this.updatingWindow && !this.updatingWindow.isDestroyed()) {
      this.updatingWindow.webContents.send(channel, data);
    }
  }

  closeUpdatingWindow(): void {
    if (this.updatingWindow && !this.updatingWindow.isDestroyed()) {
      this.updatingWindow.close();
      this.updatingWindow = undefined;
    }
  }

  // ─── Core: quit-and-install with cleanup ────────────────────────────────────

  private async performQuitAndInstall(): Promise<void> {
    log.info('[Updater] Performing quit-and-install…');
    this.sendToUpdatingWindow('update:status', 'Installing update…');

    if (this.stopBackendFn) {
      this.sendToUpdatingWindow('update:status', 'Stopping services…');
      try {
        await this.stopBackendFn();
      } catch (err) {
        log.warn('[Updater] stopBackend error (continuing):', err);
      }
    }

    this.sendToUpdatingWindow('update:status', 'Restarting…');
    await new Promise((r) => setTimeout(r, 500));

    this.setQuitForUpdateFlag(true);

    const runQuitAndInstall = () => {
      try {
        if (process.platform === 'darwin') {
          (autoUpdater as { quitAndInstall: (a?: boolean, b?: boolean) => void }).quitAndInstall();
        } else {
          autoUpdater.quitAndInstall(true, true);
        }
      } catch (err) {
        log.error('[Updater] quitAndInstall threw:', err);
        this.clearQuitForUpdateFlag();
      }
    };

    if (process.platform === 'darwin') {
      setTimeout(runQuitAndInstall, 1800);
    } else {
      setImmediate(runQuitAndInstall);
    }

    setTimeout(() => {
      if (this.getQuitForUpdateFlag()) {
        log.warn('[Updater] Fallback exit — process still alive after quitAndInstall');
        this.clearQuitForUpdateFlag();
        app.exit(0);
      }
    }, process.platform === 'darwin' ? 8000 : 10000);
  }

  // ─── Startup check ─────────────────────────────────────────────────────────

  async checkOnStartup(): Promise<boolean> {
    if (!app.isPackaged) {
      log.info('[Updater] Development mode — skipping startup update check.');
      return false;
    }

    if (process.platform === 'darwin') {
      try {
        if (process.execPath.includes('/Volumes/')) {
          log.warn('[Updater] Running from disk image — skipping update.');
          this.showMacDiskImageWarningOnce();
          return false;
        }
      } catch { /* ignore */ }
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (willUpdate: boolean) => {
        if (settled) return;
        settled = true;
        this.saveLastCheckTime();
        resolve(willUpdate);
      };

      const startupTimeout = setTimeout(() => {
        log.info('[Updater] Startup check timed out — proceeding to app.');
        cleanup();
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

      autoUpdater.once('error', (err: Error) => {
        log.error('[Updater] Startup check error:', err.message);
        cleanup();
        finish(false);
      });

      autoUpdater.once('update-available', (info: UpdateInfo) => {
        log.info(`[Updater] Update available: v${info.version}. Downloading…`);
        this.createUpdatingWindow();
        this.sendToUpdatingWindow('update:status', `Downloading v${info.version}…`);
      });

      autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        const pct = Math.round(progress.percent);
        log.info(`[Updater] Downloading… ${pct}%`);
        this.sendToUpdatingWindow('update:progress', {
          percent: pct,
          message: `Downloading update… ${pct}%`,
        });
      });

      autoUpdater.once('update-downloaded', async (info: UpdateInfo) => {
        log.info(`[Updater] v${info.version} downloaded.`);
        cleanup();

        if (!this.updatingWindow || this.updatingWindow.isDestroyed()) {
          this.createUpdatingWindow();
        }
        this.sendToUpdatingWindow('update:progress', { percent: 100, message: 'Download complete.' });
        this.sendToUpdatingWindow('update:status', 'Preparing to install…');

        await this.awaitNativeMacSquirrelReady();

        log.info(`[Updater] Installing v${info.version} on startup…`);
        finish(true);
        await this.performQuitAndInstall();
      });

      log.info('[Updater] Starting startup update check…');
      autoUpdater.checkForUpdates().catch((err: any) => {
        log.error('[Updater] checkForUpdates() threw:', err?.message ?? err);
        cleanup();
        finish(false);
      });
    });
  }

  // ─── Background check ──────────────────────────────────────────────────────

  async checkForUpdates(force = false): Promise<void> {
    if (!app.isPackaged) {
      log.info('[Updater] Development mode — update check skipped.');
      return;
    }

    if (process.platform === 'darwin') {
      try {
        if (process.execPath.includes('/Volumes/')) {
          log.warn('[Updater] Running from disk image — skipping.');
          this.showMacDiskImageWarningOnce();
          return;
        }
      } catch { /* ignore */ }
    }

    if (!force && this.isWithinCooldown()) {
      const ageMin = Math.round((Date.now() - this.getLastCheckTime()) / 60_000);
      log.info(`[Updater] Cooldown active (${ageMin} min ago) — skipping.`);
      return;
    }

    log.info('[Updater] Initiating background update check…');

    // Wire up one-shot listeners for this check cycle
    const done = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      autoUpdater.once('update-not-available', () => {
        log.info('[Updater] App is up to date.');
        finish();
      });

      autoUpdater.once('error', (err: Error) => {
        log.warn('[Updater] Background check error:', err.message);
        finish();
      });

      autoUpdater.once('update-available', (info: UpdateInfo) => {
        log.info(`[Updater] Background: update v${info.version} available, downloading…`);
        this.sendToRenderer('update-available', { version: info.version, releaseNotes: info.releaseNotes });
        finish();
      });

      autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        const percent = Math.round(progress.percent);
        log.info(`[Updater] Background downloading… ${percent}%`);
        this.sendToRenderer('update-download-progress', {
          percent,
          bytesPerSecond: Math.round(progress.bytesPerSecond),
          transferred: progress.transferred,
          total: progress.total,
        });
      });

      autoUpdater.once('update-downloaded', async (info: UpdateInfo) => {
        log.info(`[Updater] Background: v${info.version} downloaded.`);
        this.sendToRenderer('update-downloaded', { version: info.version });
        await this.awaitNativeMacSquirrelReady();
        await this.promptRestart(info.version);
      });
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      log.warn('[Updater] checkForUpdates threw:', err?.message ?? err);
    } finally {
      if (app.isPackaged) this.saveLastCheckTime();
    }

    await done;
  }

  startPeriodicChecks(): void {
    if (this.hourlyTimer) return;
    this.hourlyTimer = setInterval(() => {
      this.checkForUpdates().catch((err) =>
        log.warn('[Updater] Periodic check error:', err),
      );
    }, UPDATE_CHECK_INTERVAL_MS);
    if (this.hourlyTimer.unref) this.hourlyTimer.unref();
    log.info('[Updater] Hourly update checks started.');
  }

  stopPeriodicChecks(): void {
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = undefined;
      log.info('[Updater] Hourly update checks stopped.');
    }
  }

  // ─── Cooldown helpers ───────────────────────────────────────────────────────

  private getLastCheckTime(): number {
    try {
      if (fs.existsSync(this.lastCheckFile)) {
        const data = JSON.parse(fs.readFileSync(this.lastCheckFile, 'utf-8'));
        return typeof data.lastCheck === 'number' ? data.lastCheck : 0;
      }
    } catch { /* ignore */ }
    return 0;
  }

  private saveLastCheckTime(): void {
    try {
      fs.writeFileSync(
        this.lastCheckFile,
        JSON.stringify({ lastCheck: Date.now(), checkedAt: new Date().toISOString() }),
        'utf-8',
      );
    } catch (err) {
      log.warn('[Updater] Could not persist last-check timestamp:', err);
    }
  }

  private isWithinCooldown(): boolean {
    return Date.now() - this.getLastCheckTime() < UPDATE_CHECK_INTERVAL_MS;
  }

  // ─── macOS Squirrel wait ────────────────────────────────────────────────────

  private async awaitNativeMacSquirrelReady(): Promise<void> {
    if (process.platform !== 'darwin') return;
    const nativeAu = electron.autoUpdater;
    if (!nativeAu || typeof nativeAu.once !== 'function') {
      log.warn('[Updater] electron.autoUpdater unavailable — skipping Squirrel wait');
      return;
    }
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(failSafe); resolve(); };
      nativeAu.once('update-downloaded', finish);
      const failSafe = setTimeout(finish, 20_000);
    });
  }

  private showMacDiskImageWarningOnce(): void {
    const flag = path.join(path.dirname(this.lastCheckFile), '.billbook_dmg_update_warning_shown');
    if (fs.existsSync(flag)) return;
    try { fs.writeFileSync(flag, new Date().toISOString(), 'utf-8'); } catch { /* ignore */ }
    try {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Move BillBookPlus to Applications',
        message: 'Automatic updates only install when BillBookPlus runs from the Applications folder.',
        detail:
          'You appear to be running from a disk image or external volume. Quit, drag BillBookPlus into Applications, eject the disk image if needed, then open it from there.',
      });
    } catch { /* ignore */ }
  }

  // ─── Background restart prompt ──────────────────────────────────────────────

  private async promptRestart(version: string): Promise<void> {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;

    const laterHint = process.platform === 'darwin'
      ? 'If you choose Later, fully quit with ⌘Q (BillBookPlus menu → Quit). ' +
        'Closing only the main window leaves the app running, so the update will not install.\n\n' +
        'If Restart Now still fails, ensure BillBookPlus is in Applications.'
      : 'Restart now to apply the update, or choose Later and quit the app when you are ready.';

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready to install',
      message: `BillBookPlus ${version} has been downloaded.`,
      detail: laterHint,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      this.createUpdatingWindow();
      this.sendToUpdatingWindow('update:status', 'Installing update…');
      await this.performQuitAndInstall();
    }
  }

  // ─── Flags ──────────────────────────────────────────────────────────────────

  private setQuitForUpdateFlag(value: boolean): void {
    (globalThis as typeof globalThis & { __billbookQuitForUpdate?: boolean }).__billbookQuitForUpdate = value;
  }

  private getQuitForUpdateFlag(): boolean {
    return !!(globalThis as typeof globalThis & { __billbookQuitForUpdate?: boolean }).__billbookQuitForUpdate;
  }

  private clearQuitForUpdateFlag(): void {
    this.setQuitForUpdateFlag(false);
  }

  // ─── IPC helper ─────────────────────────────────────────────────────────────

  private sendToRenderer(channel: string, payload?: object): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
