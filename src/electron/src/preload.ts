import { contextBridge, ipcRenderer } from 'electron';

// ── Runtime config ────────────────────────────────────────────────────────────
// Expose the actual backend/frontend ports chosen at startup as
// window.__ELECTRON_CONFIG__ so frontend code (e.g. whatsappApi.js) can reach
// the correct port without an async IPC call — works in both dev and packaged mode.
// The static server also injects this into index.html in packaged mode (belt+braces).
try {
  const runtimeConfig = ipcRenderer.sendSync('get-config-sync') as {
    backendPort: number;
    frontendPort: number;
  } | null;
  if (runtimeConfig) {
    contextBridge.exposeInMainWorld('__ELECTRON_CONFIG__', runtimeConfig);
  }
} catch {
  // Loading screen / early windows: services not started yet, ports unknown.
  // The frontend URL is loaded after services are ready, so the preload will
  // run again at that point with correct port values.
}

/**
 * Preload Script
 * Exposes safe IPC methods to the renderer process
 * 
 * Security:
 * - Context isolation is enabled
 * - Node integration is disabled
 * - Only whitelisted methods are exposed
 */

export interface InitProgress {
  message: string;
  percent: number;
  stage: string;
}

export interface InitResult {
  success: boolean;
  error?: string;
}

export interface UpdateAvailableInfo {
  version: string;
  releaseNotes?: string | null;
}

export interface UpdateDownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateDownloadedInfo {
  version: string;
}

// Expose safe API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Initialize the application
   * Triggers the full initialization sequence:
   * 1. Check/install dependencies
   * 2. Clone/update repositories
   * 3. Install npm packages
   * 4. Build frontend
   * 5. Start services
   */
  initializeApp: (): Promise<InitResult> => {
    return ipcRenderer.invoke('initialize-app');
  },
  
  /**
   * Listen for initialization progress updates
   */
  onInitProgress: (callback: (progress: InitProgress) => void) => {
    const listener = (_event: any, progress: InitProgress) => callback(progress);
    ipcRenderer.on('init-progress', listener);
    
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('init-progress', listener);
    };
  },
  
  /**
   * Listen for initialization errors
   */
  onInitError: (callback: (error: string) => void) => {
    const listener = (_event: any, error: string) => callback(error);
    ipcRenderer.on('init-error', listener);
    
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('init-error', listener);
    };
  },
  
  /**
   * Listen for initialization completion
   */
  onInitComplete: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('init-complete', listener);
    
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('init-complete', listener);
    };
  },
  
  /**
   * Get application configuration
   */
  getConfig: () => {
    return ipcRenderer.invoke('get-config');
  },
  
  /**
   * Restart the application
   */
  restartApp: (): Promise<void> => {
    return ipcRenderer.invoke('restart-app');
  },
  
  /**
   * Open external URL in browser
   */
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  },

  // ─── Update events ──────────────────────────────────────────────────────────

  /** Fired when the updater starts a GitHub check */
  onUpdateChecking: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update-checking', listener);
    return () => ipcRenderer.removeListener('update-checking', listener);
  },

  /** Fired when a newer version is found on GitHub Releases */
  onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => {
    const listener = (_event: any, info: UpdateAvailableInfo) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },

  /** Fired when the app is already on the latest version */
  onUpdateNotAvailable: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },

  /** Fired periodically with download progress while the update is downloading */
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    const listener = (_event: any, progress: UpdateDownloadProgress) => callback(progress);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },

  /** Fired when the update has fully downloaded and is ready to install */
  onUpdateDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => {
    const listener = (_event: any, info: UpdateDownloadedInfo) => callback(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },

  /** Fired when the updater encounters an error (non-fatal) */
  onUpdateError: (callback: (err: { message: string }) => void) => {
    const listener = (_event: any, err: { message: string }) => callback(err);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },

  /** Manually trigger an update check (bypasses the 1-hour cooldown) */
  checkForUpdates: (): Promise<void> => {
    return ipcRenderer.invoke('check-for-updates');
  },
});

// Type definitions for renderer process
declare global {
  interface Window {
    /** Injected by the Electron preload before page JS runs. Available in both dev and packaged mode. */
    __ELECTRON_CONFIG__?: { backendPort: number; frontendPort: number };
    electronAPI: {
      initializeApp: () => Promise<InitResult>;
      onInitProgress: (callback: (progress: InitProgress) => void) => () => void;
      onInitError: (callback: (error: string) => void) => () => void;
      onInitComplete: (callback: () => void) => () => void;
      getConfig: () => Promise<any>;
      restartApp: () => Promise<void>;
      openExternal: (url: string) => void;
      // Update events
      onUpdateChecking: (callback: () => void) => () => void;
      onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => () => void;
      onUpdateNotAvailable: (callback: () => void) => () => void;
      onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void;
      onUpdateDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => () => void;
      onUpdateError: (callback: (err: { message: string }) => void) => () => void;
      checkForUpdates: () => Promise<void>;
    };
  }
}
