import { app, BrowserWindow, ipcMain, shell, dialog, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PathResolver } from './pathResolver';
import { DependencyManager } from './dependencyManager';
import { ServiceManager } from './serviceManager';
import { UpdateManager } from './updateManager';
import { loadConfig, AppConfig } from './config';

/**
 * Main Electron Process (V2)
 * First run: install deps, fetch repos, build, then start services.
 * Normal run: start backend + frontend only; check for updates in parallel and notify to restart.
 * Quit: stop all services and ensure ports are closed before exit.
 * Persistence: Electron default session (localStorage in userData).
 */

class Application {
  private mainWindow?: BrowserWindow;
  private initWindow?: BrowserWindow;
  private pathResolver: PathResolver;
  private dependencyManager: DependencyManager;
  private serviceManager: ServiceManager;
  private updateManager: UpdateManager;
  private config: AppConfig;
  private isInitialized: boolean = false;
  private quitting: boolean = false;
  
  constructor() {
    this.fixEnvironmentPath();
    
    this.pathResolver = new PathResolver();
    this.config = loadConfig(this.pathResolver.getUserDataPath(), app.getAppPath());
    
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║         APPLICATION CONFIGURATION LOADED              ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('\n📋 Complete Configuration:');
    console.log(JSON.stringify(this.config, null, 2));
    console.log('\n📁 Paths:');
    console.log('  User Data:', this.pathResolver.getUserDataPath());
    console.log('  Repos:', this.pathResolver.getReposPath());
    console.log('  Logs:', this.pathResolver.getLogsPath());
    console.log('  Packaged:', app.isPackaged);
    if (app.isPackaged) {
      console.log('  Bundled Backend:', this.pathResolver.getBundledBackendPath());
      console.log('  Bundled Frontend:', this.pathResolver.getBundledFrontendPath());
    }
    console.log('\n═══════════════════════════════════════════════════════\n');
    
    this.dependencyManager = new DependencyManager(this.pathResolver);
    this.serviceManager = new ServiceManager(this.pathResolver, this.config);

    // UpdateManager takes a userDataPath and a live reference to the main window.
    this.updateManager = new UpdateManager(
      this.pathResolver.getUserDataPath(),
      () => this.mainWindow,
    );
  }
  
  /**
   * Fix PATH to include portable Node/Git (no admin) first, then common installation directories
   */
  private fixEnvironmentPath(): void {
    const pathResolver = new PathResolver();
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const current = process.env.PATH || '';
    const portable: string[] = [];
    if (pathResolver.isPortableNodeInstalled()) {
      portable.push(pathResolver.getPortableNodeBinPath());
    }
    if (pathResolver.isPortableGitInstalled()) {
      portable.push(pathResolver.getPortableGitBinPath());
    }
    const common = process.platform === 'darwin'
      ? ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\nodejs', 'C:\\Windows\\System32']
      : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    const combined = [...portable, ...common, ...current.split(pathSep).filter(Boolean)];
    const unique = [...new Set(combined)];
    process.env.PATH = unique.join(pathSep);
    if (portable.length > 0) {
      console.log('✅ PATH includes portable Node/Git (no admin):', portable.join(', '));
    }
  }
  
  // ─── Security ──────────────────────────────────────────────────────────────

  /**
   * Content Security Policy — injected into every HTTP/HTTPS response served
   * to the renderer. Restricts which scripts, styles, and connections are
   * permitted, closing the door on XSS and data-exfiltration attacks.
   *
   * Called once during initialize(), before any window is created.
   */
  private setupContentSecurityPolicy(): void {
    // AWS backend URL baked into the frontend build via VITE_API_BASE_URL.
    const awsBackend = 'https://be.billbookplus.com';

    // The CSP is evaluated on every request so it always reflects the actual
    // runtime ports — even when the preferred port was already in use and the
    // service manager chose a different one.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const fePort = this.serviceManager.getFrontendPort();
      const bePort = this.serviceManager.getBackendPort();
      const fe = `http://localhost:${fePort}`;
      const be = `http://localhost:${bePort}`;
      const beAlt = `http://127.0.0.1:${bePort}`;

      const csp = [
        // Restrict all resource types to the app itself by default
        `default-src 'self' ${fe}`,
        // Scripts: only from the Vite-built frontend bundle — no inline, no eval
        `script-src 'self' ${fe}`,
        // Styles: 'unsafe-inline' required by most React UI component libraries
        `style-src 'self' 'unsafe-inline' ${fe}`,
        // Images: data URIs and blobs used by receipts/barcodes; https for avatars
        `img-src 'self' data: blob: https:`,
        // Fonts: bundled fonts + data URIs
        `font-src 'self' data: ${fe}`,
        // XHR/fetch/WebSocket: frontend app + local backend + AWS API
        `connect-src 'self' ${fe} ${be} ${beAlt} ${awsBackend} wss: ws:`,
        // Web Workers / Service Workers (used by Vite PWA builds)
        `worker-src 'self' blob: ${fe}`,
        // No iframes — BillBook has no <iframe> content
        `frame-src 'none'`,
        // No Flash, no PDFs, no plugins
        `object-src 'none'`,
        // Prevent base-tag hijacking
        `base-uri 'self'`,
        // Prevent this page from being embedded in an iframe on another site
        `frame-ancestors 'none'`,
      ].join('; ');

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  /**
   * Apply navigation lock + new-window handler to a BrowserWindow.
   *
   * Navigation lock (will-navigate):
   *   Blocks any redirect to a URL that is not in the allowed list.
   *   Prevents file:// redirects, open-redirect attacks, and accidental
   *   navigations caused by compromised JS in the renderer.
   *
   * Window-open handler (setWindowOpenHandler):
   *   Denies opening any NEW Electron window from the renderer.
   *   External http/https links are opened in the system browser instead.
   *
   * @param win           The window to protect.
   * @param allowedOrigins  URL prefixes that navigation IS permitted to.
   * @param allowFile     Allow file:// URLs (used only for loading/init screens).
   */
  private applyWindowSecurity(
    win: BrowserWindow,
    allowedOrigins: string[] | (() => string[]),
    allowFile = false,
  ): void {
    win.webContents.on('will-navigate', (event, url) => {
      // Evaluate getter at navigation time so runtime ports are always current
      const origins = typeof allowedOrigins === 'function' ? allowedOrigins() : allowedOrigins;
      const permitted =
        (allowFile && url.startsWith('file://')) ||
        origins.some((origin) => url.startsWith(origin));

      if (!permitted) {
        event.preventDefault();
        console.warn('[Security] Blocked navigation to:', url);
      }
    });

    // Deny new Electron windows; open http(s) links in the system browser
    win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url).catch((err) =>
          console.error('[Security] openExternal failed:', err),
        );
      } else {
        console.warn('[Security] Blocked window.open() for non-http URL:', url);
      }
      return { action: 'deny' };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * V2: Determines whether to run the fast normal start (just start services)
   * or the first-time setup sequence.
   *
   * - Packaged app: always normal start — services run from bundled extraResources.
   * - Dev: normal start only when both git-cloned repos exist on disk.
   */
  private isV2NormalStart(): boolean {
    if (app.isPackaged) return true;

    const backendPath = this.pathResolver.getBackendPath();
    const frontendPath = this.pathResolver.getFrontendPath();
    return (
      fs.existsSync(path.join(backendPath, 'package.json')) &&
      fs.existsSync(path.join(frontendPath, 'package.json'))
    );
  }

  /**
   * Initialize the application (V2)
   * - When both repos exist: only start backend + frontend; fetch + npm install run in background after app is open.
   * - When repos missing: first-time setup (init window, deps, clone, install, build), then start services.
   */
  async initialize(): Promise<void> {
    this.pathResolver.initializeDirectories();
    this.setupContentSecurityPolicy();
    this.setupIpcHandlers();

    if (this.isV2NormalStart()) {
      console.log('[V2] Normal start: starting backend and frontend only (no fetch, no install)');
      await this.v2NormalStart();
    } else {
      console.log('[V2] First-time: repos missing, running full setup');
      this.createInitWindow();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.runInitializationSequence();
    }
  }

  /**
   * V2: Normal start — show loading screen, start services, then open the app.
   *
   * Git pulls are intentionally removed from this path.
   * Application updates are handled by electron-updater (GitHub Releases) which
   * downloads a new installer and prompts the user to restart — not by pulling
   * source code onto the user's machine at runtime.
   *
   * After services are ready, a rate-limited update check fires in the background
   * (skipped if the app was already checked within the last hour) and an hourly
   * timer is armed for subsequent checks.
   */
  private async v2NormalStart(): Promise<void> {
    this.createMainWindowLoading();

    try {
      this.sendProgress('services', 'Starting backend…', 20);
      await this.serviceManager.startBackendOnly(
        (msg, pct) => this.sendProgress('services', msg, 20 + pct * 0.3),
      );

      this.sendProgress('services', 'Starting frontend…', 60);
      await this.serviceManager.startFrontendOnly(
        (msg, pct) => this.sendProgress('services', msg, 60 + pct * 0.35),
      );

      this.isInitialized = true;
      this.sendProgress('complete', 'Ready', 100);

      // Use the actual runtime port — may differ from config.frontendPort if
      // the preferred port was already occupied by another process.
      const frontendUrl = `http://localhost:${this.serviceManager.getFrontendPort()}/login`;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.loadURL(frontendUrl);
        this.mainWindow.show();
      }

      // Check for a new app version in the background.
      // Skipped automatically if checked within the last hour.
      // Hourly timer keeps checking while the app is open.
      setTimeout(() => {
        this.updateManager.checkForUpdates().catch((err) =>
          console.warn('[Main] Startup update check failed:', err),
        );
        this.updateManager.startPeriodicChecks();
      }, 5_000); // 5-second grace period so the UI settles first.

    } catch (error: any) {
      console.error('V2 normal start failed:', error);
      const errMsg = error?.message || String(error);
      this.sendProgress('services', 'Error: ' + errMsg, 0);
      this.sendError(errMsg);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
      }
    }
  }

  /** V2: Create main window in loading state – show "BillBookPlus Loading" + spinner until services are ready */
  private createMainWindowLoading(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Loading screen is a local file; it navigates to localhost once services are ready.
    // Use a getter so navigation check always uses the actual runtime frontend port.
    this.applyWindowSecurity(
      this.mainWindow,
      () => [`http://localhost:${this.serviceManager.getFrontendPort()}`],
      true, // allow file:// for the loading.html itself
    );

    this.mainWindow.once('ready-to-show', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.show();
    });
    const loadingPath = path.join(__dirname, '..', '..', 'renderer', 'loading.html');
    this.mainWindow.loadFile(loadingPath);
    this.setupMainWindowCloseHandler();
    this.mainWindow.on('closed', () => {
      this.mainWindow = undefined;
      if (!this.quitting) app.quit();
    });
  }

  /**
   * When user clicks red X: show "Do you want to exit?" dialog.
   * Cancel → keep app open. Exit → stop services, kill PIDs on backend/frontend ports, then close and quit.
   */
  private setupMainWindowCloseHandler(): void {
    const win = this.mainWindow;
    if (!win) return;
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      (async () => {
        const choice = await dialog.showMessageBox(win, {
          type: 'question',
          title: 'Exit application',
          message: 'Do you want to exit the application?',
          buttons: ['Cancel', 'Exit'],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) {
          // Cancel clicked – do not close
          return;
        }
        this.quitting = true;
        await this.serviceManager.stopAllServicesForExit();
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
        app.quit();
      })();
    });
  }

  
  /**
   * Create the initialization window (dev first-time setup only)
   */
  private createInitWindow(): void {
    this.initWindow = new BrowserWindow({
      width: 800,
      height: 600,
      resizable: false,
      frame: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Init window only ever shows a local HTML file — no external navigation
    this.applyWindowSecurity(this.initWindow, [], true); // file:// only

    // Load initialization UI
    const initPath = path.join(__dirname, '..', '..', 'renderer', 'init.html');
    this.initWindow.loadFile(initPath);

    if (process.env.NODE_ENV === 'development') {
      this.initWindow.webContents.openDevTools();
    }

    this.initWindow.on('closed', () => {
      this.initWindow = undefined;
    });
  }
  
  /**
   * Create the main application window (used in dev after first-time setup)
   */
  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Main window only navigates within the frontend origin.
    // Use a getter so the check always reflects the actual runtime port.
    this.applyWindowSecurity(this.mainWindow, () => [
      `http://localhost:${this.serviceManager.getFrontendPort()}`,
    ]);

    // Load frontend application (directly to /login) using the actual runtime port
    const frontendUrl = `http://localhost:${this.serviceManager.getFrontendPort()}/login`;
    this.mainWindow.loadURL(frontendUrl);

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      if (this.initWindow && !this.initWindow.isDestroyed()) {
        this.initWindow.close();
      }
    });
    this.setupMainWindowCloseHandler();
    this.mainWindow.on('closed', () => {
      this.mainWindow = undefined;
      if (!this.quitting) app.quit();
    });
  }
  
  /**
   * Send progress update to initialization window (or main window when V2 normal start)
   */
  private sendProgress(stage: string, message: string, percent: number): void {
    const win = this.initWindow ?? this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('init-progress', { stage, message, percent });
    }
  }

  /**
   * Send error to initialization window (or main window when V2 normal start)
   */
  private sendError(error: string): void {
    const win = this.initWindow ?? this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('init-error', error);
    }
  }

  /**
   * Send completion notification to initialization window
   */
  private sendComplete(): void {
    const win = this.initWindow ?? this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('init-complete');
    }
  }
  
  /**
   * Run the full initialization sequence
   */
  private async runInitializationSequence(): Promise<void> {
    try {
      console.log('Starting initialization sequence...');
      
      // Stage 1: Dependencies (0-30%)
      this.sendProgress('dependencies', 'Checking system dependencies...', 0);
      await this.dependencyManager.ensureAllDependencies((message, percent) => {
        this.sendProgress('dependencies', message, percent * 0.3);
      });

      // Stage 2: Services — install deps, build, start (30-100%)
      this.sendProgress('services', 'Starting services...', 30);
      await this.serviceManager.startAllServices((message, percent) => {
        this.sendProgress('services', message, 30 + percent * 0.7);
      });
      
      // V2: Mark first-time setup complete so next launch only starts services
      this.pathResolver.setV2Ready();
      this.sendProgress('complete', 'Initialization complete!', 100);
      this.sendComplete();
      this.isInitialized = true;
      
      console.log('Initialization complete! (V2 ready flag set)');
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.createMainWindow();
      
    } catch (error: any) {
      console.error('Initialization failed:', error);
      this.sendError(error.message || 'Unknown error occurred');
      this.isInitialized = false;
    }
  }
  
  /**
   * Setup IPC handlers
   */
  private setupIpcHandlers(): void {
    // Initialize app
    ipcMain.handle('initialize-app', async () => {
      try {
        if (this.isInitialized) {
          return { success: true };
        }
        
        await this.runInitializationSequence();
        return { success: true };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Initialization failed',
        };
      }
    });
    
    // Restart app (stop services and free ports first so restart can bind)
    ipcMain.handle('restart-app', async () => {
      if (application) {
        application['quitting'] = true;
        await application['serviceManager'].stopAllServicesForExit();
      }
      app.relaunch();
      app.exit(0);
    });
    
    // Get config — returns actual runtime ports (not just configured defaults)
    ipcMain.handle('get-config', () => {
      return {
        appName: this.config.appName,
        backendPort: this.serviceManager.getBackendPort(),
        frontendPort: this.serviceManager.getFrontendPort(),
      };
    });
    
    // Restart app (stop services first so ports are free for new instance)
    ipcMain.on('restart-app', async () => {
      if (application) {
        application['quitting'] = true;
        await application['serviceManager'].stopAllServicesForExit();
      }
      app.relaunch();
      app.exit(0);
    });
    
    // Open external URL
    ipcMain.on('open-external', (_event, url: string) => {
      shell.openExternal(url);
    });

    // Synchronous config — called by the preload script before page JS runs so
    // that window.__ELECTRON_CONFIG__ is available the moment React code starts.
    ipcMain.on('get-config-sync', (event) => {
      event.returnValue = {
        backendPort: this.serviceManager.getBackendPort(),
        frontendPort: this.serviceManager.getFrontendPort(),
      };
    });

    // Manual "Check for updates" — bypasses the 1-hour cooldown
    ipcMain.handle('check-for-updates', async () => {
      await this.updateManager.checkForUpdates(true);
    });
  }
  
  /**
   * V2: Cleanup on app quit - stop services and timers quickly so the app closes in ~1–2 s.
   */
  async cleanup(): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    console.log('[V2] Cleanup: stopping services and update timer…');
    this.updateManager.stopPeriodicChecks();
    await this.serviceManager.stopAllServicesForExit();
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.close();
      }
    });
    console.log('[V2] Cleanup done.');
  }
}

// Application instance
let application: Application;

// App lifecycle events
app.on('ready', async () => {
  console.log('Electron app ready');
  application = new Application();
  await application.initialize();
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    application = new Application();
    application.initialize();
  }
});

app.on('before-quit', (e) => {
  if (!application) return;
  if (application['quitting']) return;
  e.preventDefault();
  application['quitting'] = true;
  (async () => {
    await application.cleanup();
    app.exit(0);
  })();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
