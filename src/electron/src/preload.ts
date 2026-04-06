import { contextBridge, ipcRenderer } from 'electron';

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
});

// Type definitions for renderer process
declare global {
  interface Window {
    electronAPI: {
      initializeApp: () => Promise<InitResult>;
      onInitProgress: (callback: (progress: InitProgress) => void) => () => void;
      onInitError: (callback: (error: string) => void) => () => void;
      onInitComplete: (callback: () => void) => () => void;
      getConfig: () => Promise<any>;
      restartApp: () => Promise<void>;
      openExternal: (url: string) => void;
    };
  }
}
