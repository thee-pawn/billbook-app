import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { dialog, app, BrowserWindow } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Production Update Manager
 *
 * Uses electron-updater to check GitHub Releases for new app versions.
 *
 * Rate-limiting strategy (avoids GitHub API rate limits):
 *  - Checks on startup (respecting the 1-hour cooldown).
 *  - Starts an hourly interval timer after the first check.
 *  - Skips any check that is within 60 minutes of the previous one.
 *  - In development (app.isPackaged === false) all checks are skipped.
 */

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LAST_CHECK_FILENAME = 'last-update-check.json';

export class UpdateManager {
  private lastCheckFile: string;
  private hourlyTimer?: NodeJS.Timeout;
  private getMainWindow: () => BrowserWindow | undefined;

  constructor(userDataPath: string, getMainWindow: () => BrowserWindow | undefined) {
    this.lastCheckFile = path.join(userDataPath, LAST_CHECK_FILENAME);
    this.getMainWindow = getMainWindow;
    this.configureUpdater();
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  private configureUpdater(): void {
    // Route all updater logs through electron-log (written to disk on Windows too)
    autoUpdater.logger = log;
    (autoUpdater.logger as any).transports.file.level = 'info';

    // Download silently in the background; user is prompted after download completes.
    autoUpdater.autoDownload = true;

    // Install on next quit if the user clicks "Later"
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      log.info('[Updater] Checking for update…');
      this.sendToRenderer('update-checking');
    });

    autoUpdater.on('update-not-available', () => {
      log.info('[Updater] App is up to date.');
      this.sendToRenderer('update-not-available');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info('[Updater] Update available:', info.version);
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

    autoUpdater.on('update-downloaded', async (info: UpdateInfo) => {
      log.info('[Updater] Update downloaded:', info.version);
      this.sendToRenderer('update-downloaded', { version: info.version });
      await this.promptRestart(info.version);
    });

    autoUpdater.on('error', (err: Error) => {
      log.warn('[Updater] Error (non-fatal):', err.message);
      this.sendToRenderer('update-error', { message: err.message });
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check for a new app version on GitHub Releases.
   *
   * @param force  If true, bypasses the 1-hour cooldown (e.g. manual "Check for updates").
   *
   * Safe to call from startup AND from the periodic timer — the cooldown guard
   * prevents spamming GitHub's API.
   */
  async checkForUpdates(force = false): Promise<void> {
    if (!app.isPackaged) {
      log.info('[Updater] Development mode — update check skipped.');
      return;
    }

    if (!force && this.isWithinCooldown()) {
      const ageMin = Math.round((Date.now() - this.getLastCheckTime()) / 60_000);
      log.info(`[Updater] Cooldown active (${ageMin} min ago) — skipping.`);
      return;
    }

    this.saveLastCheckTime();
    log.info('[Updater] Initiating update check…');

    try {
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      log.warn('[Updater] checkForUpdates threw (non-fatal):', err?.message ?? err);
    }
  }

  /**
   * Start the recurring hourly update check.
   * Call once after the app window is fully ready.
   * The timer is unreffed so it never prevents Node from exiting.
   */
  startPeriodicChecks(): void {
    if (this.hourlyTimer) return;

    this.hourlyTimer = setInterval(() => {
      this.checkForUpdates().catch((err) =>
        log.warn('[Updater] Periodic check error:', err),
      );
    }, UPDATE_CHECK_INTERVAL_MS);

    // Allow the process to exit naturally even when the timer is pending.
    if (this.hourlyTimer.unref) {
      this.hourlyTimer.unref();
    }

    log.info('[Updater] Hourly update checks started (interval: 60 min).');
  }

  /**
   * Stop the periodic timer. Call during app cleanup / before quit.
   */
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
    } catch {
      // Ignore corrupt/missing file — treat as never checked.
    }
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

  // ─── Restart prompt ─────────────────────────────────────────────────────────

  private async promptRestart(version: string): Promise<void> {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      // No window — install silently on quit.
      return;
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready to install',
      message: `BillBook ${version} has been downloaded.`,
      detail: 'Restart now to apply the update, or continue working and it will be installed when you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      // quitAndInstall(isSilent, isForceRunAfter)
      autoUpdater.quitAndInstall(false, true);
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
