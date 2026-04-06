import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PathResolver } from './pathResolver';
import { DependencyManager } from './dependencyManager';
import { RepositoryManager } from './repositoryManager';
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
  private repositoryManager: RepositoryManager;
  private serviceManager: ServiceManager;
  private updateManager: UpdateManager;
  private config: AppConfig;
  private isInitialized: boolean = false;
  private quitting: boolean = false;
  
  constructor() {
    // Fix PATH to include common installation directories
    // This is crucial for packaged apps which have limited PATH
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
    console.log('  Backend:', this.pathResolver.getBackendPath());
    console.log('  Frontend:', this.pathResolver.getFrontendPath());
    console.log('  Logs:', this.pathResolver.getLogsPath());
    console.log('  Update check log file:', this.pathResolver.getLogFilePath('update-check'));
    console.log('\n═══════════════════════════════════════════════════════\n');
    
    this.dependencyManager = new DependencyManager(this.pathResolver);
    this.repositoryManager = new RepositoryManager(this.pathResolver, this.config);
    this.serviceManager = new ServiceManager(this.pathResolver, this.config);
    this.updateManager = new UpdateManager(this.pathResolver, this.config);
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
  
  /** V2: True when both repos exist so we only start backend/frontend (no fetch, no install on startup) */
  private isV2NormalStart(): boolean {
    const backendPath = this.pathResolver.getBackendPath();
    const frontendPath = this.pathResolver.getFrontendPath();
    const backendReady = fs.existsSync(path.join(backendPath, 'package.json'));
    const frontendReady = fs.existsSync(path.join(frontendPath, 'package.json'));
    return backendReady && frontendReady;
  }

  /**
   * Initialize the application (V2)
   * - When both repos exist: only start backend + frontend; fetch + npm install run in background after app is open.
   * - When repos missing: first-time setup (init window, deps, clone, install, build), then start services.
   */
  async initialize(): Promise<void> {
    this.pathResolver.initializeDirectories();
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
   * V2: Normal start - create main window (loading), check for updates then start backend and frontend.
   * If updates found: pull, npm install (and backend build), then run dev. If no updates: run dev directly.
   */
  private async v2NormalStart(): Promise<void> {
    this.createMainWindowLoading();
    const backendPath = this.pathResolver.getBackendPath();
    const frontendPath = this.pathResolver.getFrontendPath();
    try {
      this.sendProgress('services', 'Checking for backend updates', 10);
      let backendChanged = false;
      try {
        backendChanged = await this.updateManager.pullRepo(backendPath);
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error('Backend pull failed:', e);
        this.sendProgress('services', 'Error fetching backend updates: ' + msg, 12);
        this.sendError(msg);
        throw new Error('Failed to fetch backend updates: ' + msg);
      }
      if (backendChanged) {
        this.sendProgress('services', 'Updating backend', 15);
        await this.updateManager.installRepo(backendPath);
        await this.updateManager.buildBackendIfConfigured();
      }

      this.sendProgress('services', 'Starting backend', 30);
      await this.serviceManager.startBackendOnly();

      this.sendProgress('services', 'Checking for frontend updates', 50);
      let frontendChanged = false;
      try {
        frontendChanged = await this.updateManager.pullRepo(frontendPath);
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error('Frontend pull failed:', e);
        this.sendProgress('services', 'Error fetching frontend updates: ' + msg, 52);
        this.sendError(msg);
        throw new Error('Failed to fetch frontend updates: ' + msg);
      }
      if (frontendChanged) {
        this.sendProgress('services', 'Updating frontend', 55);
        await this.updateManager.installRepo(frontendPath);
      }

      this.sendProgress('services', 'Starting frontend', 70);
      await this.serviceManager.startFrontendOnly();

      this.isInitialized = true;
      this.sendProgress('complete', 'Ready', 100);
      const frontendUrl = `http://localhost:${this.config.frontendPort}/login`;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.loadURL(frontendUrl);
        this.mainWindow.show();
      }
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
        preload: path.join(__dirname, 'preload.js'),
      },
    });
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

  /** Append a line to the update-check log file (for debugging on Windows where console is not visible) */
  private appendUpdateLog(message: string, err?: unknown): void {
    try {
      const logDir = this.pathResolver.getLogsPath();
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logPath = this.pathResolver.getLogFilePath('update-check');
      const ts = new Date().toISOString();
      const line = err
        ? `${ts} ${message} ERROR: ${err instanceof Error ? err.message : String(err)}${err instanceof Error && err.stack ? '\n' + err.stack : ''}\n`
        : `${ts} ${message}\n`;
      fs.appendFileSync(logPath, line, 'utf-8');
    } catch (_) {}
  }

  /** V2: Run fetch + npm install only in background after app is open; notify to restart if updates applied */
  private startUpdateCheckInBackground(): void {
    const delayMs = 5000;
    console.log('[V2] Background: update check scheduled in', delayMs, 'ms (platform:', process.platform, ')');
    this.appendUpdateLog(`Update check scheduled in ${delayMs}ms (platform: ${process.platform})`);
    setTimeout(async () => {
      try {
        console.log('[V2] Background: checking for updates (git pull + npm install)...');
        this.appendUpdateLog('Checking for updates (git pull + npm install)...');
        const result = await this.updateManager.checkAndApplyUpdates();
        if (result.updatesApplied) {
          console.log('[V2] Updates applied, notifying user to restart');
          this.appendUpdateLog('Updates applied; user will be prompted to restart.');
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('v2-updates-applied');
            const choice = await dialog.showMessageBox(this.mainWindow, {
              type: 'info',
              title: 'Updates installed',
              message: 'Updates have been installed in the background. Restart the application to use the latest code.',
              buttons: ['Restart now', 'Later'],
              defaultId: 0,
            });
            if (choice.response === 0) {
              this.quitting = true;
              await this.serviceManager.stopAllServicesForExit();
              app.relaunch();
              app.exit(0);
            }
          }
        } else {
          console.log('[V2] Background: no updates or already up to date');
          if (result.error) {
            this.appendUpdateLog('No new code pulled. Error (non-fatal): ' + result.error);
          } else {
            this.appendUpdateLog('No updates (already up to date).');
          }
        }
      } catch (e: any) {
        console.warn('[V2] Background update check failed:', e?.message ?? e, e?.stack);
        this.appendUpdateLog('Background update check failed.', e);
      }
    }, delayMs);
  }
  
  /**
   * Create the initialization window
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
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    
    // Load initialization UI
    const initPath = path.join(__dirname, '..', '..', 'renderer', 'init.html');
    this.initWindow.loadFile(initPath);
    
    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      this.initWindow.webContents.openDevTools();
    }
    
    this.initWindow.on('closed', () => {
      this.initWindow = undefined;
    });
  }
  
  /**
   * Create the main application window
   */
  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    
    // Load frontend application (directly to /login)
    const frontendUrl = `http://localhost:${this.config.frontendPort}/login`;
    this.mainWindow.loadURL(frontendUrl);
    
    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      
      // Close initialization window
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
      
      // Stage 1: Dependencies (0-20%)
      this.sendProgress('dependencies', 'Checking system dependencies...', 0);
      await this.dependencyManager.ensureAllDependencies((message, percent) => {
        this.sendProgress('dependencies', message, percent * 0.2);
      });
      
      // Stage 2: Repositories (20-40%)
      this.sendProgress('repositories', 'Setting up repositories...', 20);
      await this.repositoryManager.ensureAllRepositories((message, percent) => {
        this.sendProgress('repositories', message, 20 + percent * 0.2);
      });
      
      // Stage 3: Services (40-100%)
      this.sendProgress('services', 'Starting services...', 40);
      await this.serviceManager.startAllServices((message, percent) => {
        this.sendProgress('services', message, 40 + percent * 0.6);
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
    
    // Get config
    ipcMain.handle('get-config', () => {
      return {
        appName: this.config.appName,
        backendPort: this.config.backendPort,
        frontendPort: this.config.frontendPort,
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
  }
  
  /**
   * V2: Cleanup on app quit - stop backend/frontend quickly so the app closes in ~1–2 s.
   */
  async cleanup(): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    console.log('[V2] Cleanup: stopping services (fast exit)...');
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
