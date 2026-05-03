import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { dialog, app, BrowserWindow } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LAST_CHECK_FILENAME = 'last-update-check.json';

/**
 * Production Update Manager (V2)
 *
 * Flow:
 *  1. Background download — updates are downloaded silently without blocking
 *     the app. The user sees nothing during download.
 *  2. Prompt — once downloaded, user is asked "Restart Now" or "Later".
 *  3. Updating window — shown only during install (after user clicks Restart
 *     Now, or on next app quit with autoInstallOnAppQuit).
 *
 * macOS unsigned apps:
 *  Squirrel.Mac (ShipIt) rejects unsigned app bundles with
 *  "code object is not signed at all". We bypass it entirely by downloading
 *  the ZIP, extracting the new .app, swapping it with the running one, and
 *  relaunching — no code signature required.
 *
 * Windows:
 *  NSIS handles unsigned apps fine. Standard quitAndInstall works.
 */
export class UpdateManager {
  private lastCheckFile: string;
  private hourlyTimer?: NodeJS.Timeout;
  private getMainWindow: () => BrowserWindow | undefined;
  private stopBackendFn?: () => Promise<void>;
  private updatingWindow?: BrowserWindow;
  private updateDownloaded = false;
  private downloadedVersion = '';

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
    autoUpdater.autoInstallOnAppQuit = false;
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

  // ─── macOS manual update (bypasses Squirrel/ShipIt) ─────────────────────────

  /**
   * On macOS with unsigned apps, Squirrel.Mac fails with "code object is not
   * signed at all". Instead we:
   *  1. Find the downloaded ZIP in electron-updater's cache
   *  2. Extract the new .app from it
   *  3. Move the old .app to trash
   *  4. Move the new .app into place
   *  5. Relaunch from the new location
   */
  private async macManualUpdate(): Promise<void> {
    const runningAppPath = path.dirname(path.dirname(path.dirname(process.execPath)));

    if (!runningAppPath.endsWith('.app')) {
      log.error('[Updater] Cannot determine .app path from execPath:', process.execPath);
      throw new Error('Cannot determine app bundle path');
    }

    log.info('[Updater] macOS manual update — running app:', runningAppPath);

    const cacheDir = path.join(app.getPath('userData'), 'Caches', `${app.getName()}-updater`);
    log.info('[Updater] Looking for update cache in:', cacheDir);

    let updateCacheDir = cacheDir;
    if (!fs.existsSync(updateCacheDir)) {
      const altCache = path.join(
        app.getPath('home'),
        'Library',
        'Caches',
        `${app.name}-updater`,
      );
      if (fs.existsSync(altCache)) {
        updateCacheDir = altCache;
      }
    }

    const pendingDir = path.join(updateCacheDir, 'pending');
    if (!fs.existsSync(pendingDir)) {
      log.info('[Updater] No pending dir — looking for ZIP in cache root');
    }

    // electron-updater downloads the ZIP into either pending/ or the cache root
    const searchDirs = [pendingDir, updateCacheDir];
    let zipPath: string | undefined;
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const zips = files.filter((f) => f.endsWith('.zip'));
      if (zips.length > 0) {
        zipPath = path.join(dir, zips[zips.length - 1]);
        break;
      }
    }

    if (!zipPath || !fs.existsSync(zipPath)) {
      log.error('[Updater] Could not find downloaded update ZIP in:', searchDirs);
      throw new Error('Downloaded update ZIP not found');
    }

    log.info('[Updater] Found update ZIP:', zipPath);
    this.sendToUpdatingWindow('update:status', 'Extracting update…');
    this.sendToUpdatingWindow('update:progress', { percent: 30, message: 'Extracting update…' });

    // Extract to a temp dir
    const tmpDir = path.join(app.getPath('temp'), 'billbook-update-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      execSync(`ditto -xk "${zipPath}" "${tmpDir}"`, { timeout: 60_000 });
    } catch (err) {
      log.error('[Updater] Failed to extract ZIP:', err);
      throw new Error('Failed to extract update');
    }

    // Find the .app inside the extracted directory
    const extracted = fs.readdirSync(tmpDir);
    const newAppName = extracted.find((f) => f.endsWith('.app'));
    if (!newAppName) {
      log.error('[Updater] No .app found in extracted ZIP. Contents:', extracted);
      throw new Error('No .app found in update package');
    }
    const newAppPath = path.join(tmpDir, newAppName);
    log.info('[Updater] Extracted new app:', newAppPath);

    this.sendToUpdatingWindow('update:status', 'Installing update…');
    this.sendToUpdatingWindow('update:progress', { percent: 60, message: 'Installing update…' });

    // Stop backend services before replacing the app
    if (this.stopBackendFn) {
      this.sendToUpdatingWindow('update:status', 'Stopping services…');
      try {
        await this.stopBackendFn();
      } catch (err) {
        log.warn('[Updater] stopBackend error (continuing):', err);
      }
    }

    this.sendToUpdatingWindow('update:progress', { percent: 80, message: 'Replacing app…' });

    const appParentDir = path.dirname(runningAppPath);
    const appBaseName = path.basename(runningAppPath);
    const backupPath = path.join(tmpDir, appBaseName + '.old');

    try {
      // Move old app out of the way
      fs.renameSync(runningAppPath, backupPath);
    } catch (err) {
      log.error('[Updater] Failed to move old app:', err);
      // Try with shell
      try {
        execSync(`mv "${runningAppPath}" "${backupPath}"`, { timeout: 10_000 });
      } catch (err2) {
        log.error('[Updater] Shell move also failed:', err2);
        throw new Error('Failed to replace app — is it running from a read-only volume?');
      }
    }

    try {
      // Move new app into place
      fs.renameSync(newAppPath, path.join(appParentDir, appBaseName));
    } catch (err) {
      log.error('[Updater] Failed to move new app into place:', err);
      // Try with shell; cross-device moves need cp+rm
      try {
        execSync(`cp -R "${newAppPath}" "${path.join(appParentDir, appBaseName)}"`, {
          timeout: 30_000,
        });
      } catch (err2) {
        log.error('[Updater] Shell copy also failed — restoring backup:', err2);
        try {
          fs.renameSync(backupPath, runningAppPath);
        } catch { /* ignore */ }
        throw new Error('Failed to install update');
      }
    }

    this.sendToUpdatingWindow('update:progress', { percent: 95, message: 'Restarting…' });
    this.sendToUpdatingWindow('update:status', 'Restarting…');
    await new Promise((r) => setTimeout(r, 500));

    log.info('[Updater] macOS manual update complete — relaunching');

    // Clean up old app and temp in background (non-blocking)
    try {
      fs.rmSync(backupPath, { recursive: true, force: true });
    } catch { /* ignore */ }

    const newExecPath = path.join(appParentDir, appBaseName, 'Contents', 'MacOS', app.getName());
    // Relaunch the new app
    spawn(newExecPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }).unref();

    // Quit the old app
    setTimeout(() => app.exit(0), 300);
  }

  // ─── Core: quit-and-install with cleanup ────────────────────────────────────

  private async performQuitAndInstall(): Promise<void> {
    log.info('[Updater] Performing quit-and-install…');

    // Show the updating window with loader
    if (!this.updatingWindow || this.updatingWindow.isDestroyed()) {
      this.createUpdatingWindow();
    }

    // Hide the main window so only the updating loader is visible
    const mainWin = this.getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.hide();
    }

    this.sendToUpdatingWindow('update:status', 'Installing update…');
    this.sendToUpdatingWindow('update:progress', { percent: 10, message: 'Preparing…' });

    if (process.platform === 'darwin') {
      // macOS: bypass Squirrel/ShipIt for unsigned apps
      try {
        await this.macManualUpdate();
        return;
      } catch (err: any) {
        log.error('[Updater] macOS manual update failed:', err);
        this.sendToUpdatingWindow('update:error', err?.message || 'Update failed');
        // Re-show main window so user can continue using the app
        if (mainWin && !mainWin.isDestroyed()) mainWin.show();
        setTimeout(() => this.closeUpdatingWindow(), 5000);
        return;
      }
    }

    // Windows: NSIS handles unsigned apps fine
    if (this.stopBackendFn) {
      this.sendToUpdatingWindow('update:status', 'Stopping services…');
      try {
        await this.stopBackendFn();
      } catch (err) {
        log.warn('[Updater] stopBackend error (continuing):', err);
      }
    }

    this.sendToUpdatingWindow('update:status', 'Restarting…');
    this.sendToUpdatingWindow('update:progress', { percent: 90, message: 'Restarting…' });
    await new Promise((r) => setTimeout(r, 500));

    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      log.error('[Updater] quitAndInstall threw:', err);
    }

    // Fallback exit if quitAndInstall didn't work
    setTimeout(() => {
      log.warn('[Updater] Fallback exit — process still alive after quitAndInstall');
      app.exit(0);
    }, 10000);
  }

  // ─── Background check (download + prompt) ─────────────────────────────────

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

    const done = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      autoUpdater.once('update-not-available', () => {
        log.info('[Updater] App is up to date.');
        this.sendToRenderer('update-not-available');
        finish();
      });

      autoUpdater.once('error', (err: Error) => {
        log.warn('[Updater] Background check error:', err.message);
        this.sendToRenderer('update-error', { message: err.message });
        finish();
      });

      autoUpdater.once('update-available', (info: UpdateInfo) => {
        log.info(`[Updater] Update v${info.version} available, downloading silently…`);
        this.sendToRenderer('update-available', { version: info.version, releaseNotes: info.releaseNotes });
      });

      autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        const percent = Math.round(progress.percent);
        log.info(`[Updater] Downloading… ${percent}%`);
        this.sendToRenderer('update-download-progress', {
          percent,
          bytesPerSecond: Math.round(progress.bytesPerSecond),
          transferred: progress.transferred,
          total: progress.total,
        });
      });

      autoUpdater.once('update-downloaded', async (info: UpdateInfo) => {
        log.info(`[Updater] v${info.version} downloaded — prompting user.`);
        this.updateDownloaded = true;
        this.downloadedVersion = info.version;
        this.sendToRenderer('update-downloaded', { version: info.version });
        finish();
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

  // ─── macOS disk image warning ──────────────────────────────────────────────

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

  // ─── Restart prompt ────────────────────────────────────────────────────────

  private async promptRestart(version: string): Promise<void> {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready to install',
      message: `BillBookPlus ${version} has been downloaded.`,
      detail: 'Would you like to restart now to apply the update?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      await this.performQuitAndInstall();
    }
  }

  // ─── IPC helper ─────────────────────────────────────────────────────────────

  private sendToRenderer(channel: string, payload?: object): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
