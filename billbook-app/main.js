const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

let mainWindow = null;
let backendProcess = null;

// Determine if we're in development or production
const isDev = process.argv.includes('--dev') || !app.isPackaged;

// Log startup immediately
console.log('=== BillBook Application Starting ===');
console.log(`Platform: ${process.platform}`);
console.log(`Node version: ${process.versions.node}`);
console.log(`Electron version: ${process.versions.electron}`);
console.log(`Is packaged: ${app.isPackaged}`);
console.log(`Is dev: ${isDev}`);
console.log(`Working directory: ${process.cwd()}`);
console.log(`App path: ${__dirname}`);

// Log file path for production (platform-aware)
function getLogFilePath() {
  if (process.platform === 'win32') {
    // Windows: %APPDATA%\billbook-app\logs\main.log
    return path.join(os.homedir(), 'AppData', 'Roaming', 'billbook-app', 'logs', 'main.log');
  } else if (process.platform === 'darwin') {
    // macOS: ~/Library/Logs/billbook-app/main.log
    return path.join(os.homedir(), 'Library', 'Logs', 'billbook-app', 'main.log');
  } else {
    // Linux: ~/.config/billbook-app/logs/main.log
    return path.join(os.homedir(), '.config', 'billbook-app', 'logs', 'main.log');
  }
}

const logFilePath = getLogFilePath();

// Ensure log directory exists
if (app.isPackaged) {
  const logDir = path.dirname(logFilePath);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create log directory:', err);
  }
}

// Helper function to show error dialog
function showErrorDialog(title, message, detail = '') {
  const fullMessage = detail ? `${message}\n\nDetails:\n${detail}` : message;
  
  if (app.isReady()) {
    try {
      dialog.showErrorBox(title, fullMessage);
    } catch (err) {
      console.error(`[ERROR DIALOG FAILED] ${title}: ${message}`, err);
      console.error(`Full message: ${fullMessage}`);
    }
  } else {
    // If app isn't ready yet, log and schedule to show after ready
    console.error(`[ERROR DIALOG - APP NOT READY] ${title}: ${message}`);
    if (detail) console.error(`Details: ${detail}`);
    // Schedule to show after app is ready
    app.whenReady().then(() => {
      try {
        dialog.showErrorBox(title, fullMessage);
      } catch (err) {
        console.error(`[ERROR DIALOG FAILED AFTER READY] ${title}: ${message}`, err);
      }
    }).catch(() => {
      // App never becomes ready, just log it
      console.error(`[CRITICAL] App failed to become ready, error dialog lost: ${title}: ${message}`);
    });
  }
}

// Helper function to log messages (to console and file in production)
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  // Always log to console (visible in terminal for dev, system console for packaged)
  console.log(logMessage);
  
  // In production, also log to file
  if (app.isPackaged) {
    try {
      fs.appendFileSync(logFilePath, logMessage + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
}

// Get the backend path (either in resources or in project root)
function getBackendPath() {
  if (app.isPackaged) {
    // In production, backend is in extraResources
    return path.join(process.resourcesPath, 'backend');
  } else {
    // In development, backend is in project root
    return path.join(__dirname, 'backend');
  }
}

// Get the frontend dist path
function getFrontendPath() {
  if (app.isPackaged) {
    // In production, load frontend from resourcesPath (outside app.asar)
    // This matches electron-builder extraResources configuration:
    //   frontend/dist -> resources/frontend/dist
    return path.join(process.resourcesPath, 'frontend', 'dist', 'index.html');
  } else {
    // In development, use the built dist folder or fallback to dev server
    const distPath = path.join(__dirname, 'frontend', 'dist', 'index.html');
    if (fs.existsSync(distPath)) {
      return distPath;
    }
    // If dist doesn't exist, use dev server (you may want to build first)
    console.warn('Frontend dist not found. Please run "npm run build-frontend" first.');
    return 'http://localhost:5173'; // Vite dev server default
  }
}

// Start the backend server
function startBackend() {
  const backendPath = getBackendPath();
  // Backend is TypeScript, compiled output is in dist/server.js
  const serverFile = path.join(backendPath, 'dist', 'server.js');

  logToFile(`Starting backend from: ${backendPath}`);
  logToFile(`Server file: ${serverFile}`);

  if (!fs.existsSync(serverFile)) {
    const message = `Backend server file not found at: ${serverFile}. Please ensure backend is built.`;
    logToFile(`ERROR: ${message}`);
    showErrorDialog('Backend Startup Error', message, `Backend path: ${backendPath}`);
    return;
  }

  // Set NODE_ENV to production if packaged
  // Explicitly set PORT to 4242 for backend
  // Create a clean env object to avoid conflicts with parent process env vars
  // In packaged app, use 'development' mode for backend so logger outputs to console
  // This allows us to capture errors that would be lost if file logging fails
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'development', // Always use development so logger writes to console (we capture it)
    PORT: '4242' // Always use port 4242 for backend
  });

  // Set Playwright browsers path for packaged app
  if (app.isPackaged && process.resourcesPath) {
    const playwrightBrowsersPath = path.join(process.resourcesPath, 'playwright-browsers');
    if (fs.existsSync(playwrightBrowsersPath)) {
      env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
      logToFile(`Setting PLAYWRIGHT_BROWSERS_PATH to: ${playwrightBrowsersPath}`);
    }
  }

  logToFile(`Starting backend with PORT=${env.PORT}, NODE_ENV=${env.NODE_ENV}`);
  logToFile(`Backend working directory: ${backendPath}`);

  // Fork the backend process with better error handling
  // Use 'inherit' for stdio in dev, 'pipe' in production to capture logs
  const stdioConfig = app.isPackaged 
    ? ['ignore', 'pipe', 'pipe', 'ipc']  // Capture output in production
    : ['ignore', 'inherit', 'inherit', 'ipc'];  // Show in terminal in dev
  
  // Verify node_modules exists before forking
  const nodeModulesPath = path.join(backendPath, 'node_modules');
  logToFile(`Checking for node_modules at: ${nodeModulesPath}`);
  if (!fs.existsSync(nodeModulesPath)) {
    const message = `node_modules not found at ${nodeModulesPath}`;
    let contents = 'Directory not accessible';
    try {
      contents = fs.readdirSync(backendPath).join(', ');
    } catch (err) {
      contents = `Error reading directory: ${err.message}`;
    }
    logToFile(`ERROR: ${message}`);
    logToFile(`Backend path contents: ${contents}`);
    showErrorDialog('Backend Dependency Error', message, `Backend path: ${backendPath}\nContents: ${contents}`);
    return;
  }
  
  // Check for express specifically
  const expressPath = path.join(nodeModulesPath, 'express');
  if (!fs.existsSync(expressPath)) {
    const message = `express module not found at ${expressPath}`;
    logToFile(`ERROR: ${message}`);
    showErrorDialog('Backend Dependency Error', 'Express module not found', message);
    return;
  }
  
  logToFile(`node_modules found, proceeding to fork backend`);
  
  backendProcess = fork(serverFile, {
    cwd: backendPath,
    env: env,
    stdio: stdioConfig,
    silent: false  // Don't suppress output
  });

  // Log backend output - capture all output to see what's happening
  let backendStdout = '';
  let backendStderr = '';
  
  backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    backendStdout += output;
    const message = `[Backend] ${output.trim()}`;
    logToFile(message);
    // Also send to renderer process if window is ready
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-log', message);
    }
  });

  backendProcess.stderr.on('data', (data) => {
    const output = data.toString();
    backendStderr += output;
    // Log each line separately for better visibility
    const lines = output.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      const message = `[Backend Error] ${line.trim()}`;
      logToFile(message);
      console.error(message); // Also log to console immediately
      // Also send to renderer process if window is ready
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-error', message);
      }
    });
  });

  backendProcess.on('error', (error) => {
    const message = `Failed to start backend: ${error.message}`;
    logToFile(`CRITICAL ERROR: ${message}`);
    showErrorDialog('Backend Startup Failed', message, error.stack || '');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-error', message);
    }
  });

  backendProcess.on('exit', (code, signal) => {
    const message = `Backend process exited with code ${code} and signal ${signal}`;
    if (code !== null && code !== 0) {
      logToFile(`ERROR: ${message}`);
      console.error(`ERROR: ${message}`);
      
      let errorDetails = '';
      if (backendStdout) {
        logToFile(`Backend stdout output:\n${backendStdout}`);
        console.error(`Backend stdout:\n${backendStdout}`);
        errorDetails += `STDOUT:\n${backendStdout}\n\n`;
      }
      
      if (backendStderr) {
        logToFile(`CRITICAL: Backend stderr output:\n${backendStderr}`);
        console.error(`CRITICAL Backend stderr:\n${backendStderr}`);
        errorDetails += `STDERR:\n${backendStderr}`;
      } else {
        logToFile(`WARNING: Backend exited with error code but no stderr output captured`);
        console.error(`WARNING: Backend exited with error code but no stderr output captured`);
        errorDetails += 'No error output captured';
      }
      
      // Show error dialog for backend crash
      showErrorDialog('Backend Process Crashed', message, errorDetails);
    } else {
      logToFile(message);
    }
    backendProcess = null;
  });
}

// Stop the backend server
function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend server...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// Create an error window to display critical errors
function createErrorWindow(errorMessage, details = '') {
  try {
    const errorWindow = new BrowserWindow({
      width: 600,
      height: 400,
      resizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      show: true
    });

    const errorHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>BillBook - Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            padding: 20px;
            background: #f5f5f5;
            margin: 0;
          }
          .error-container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 800px;
            margin: 0 auto;
          }
          h1 {
            color: #dc3545;
            margin-top: 0;
            font-size: 24px;
          }
          .error-message {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
            font-family: monospace;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .details {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 200px;
            overflow-y: auto;
          }
          .info {
            color: #666;
            font-size: 14px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>⚠️ Application Error</h1>
          <div class="error-message">${errorMessage.replace(/\n/g, '<br>')}</div>
          ${details ? `<div class="details">${details.replace(/\n/g, '<br>')}</div>` : ''}
          <div class="info">
            <strong>Log file location:</strong><br>
            ${logFilePath}<br><br>
            Please check the log file for more details or contact support.
          </div>
        </div>
      </body>
      </html>
    `;

    errorWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHTML));
    return errorWindow;
  } catch (err) {
    console.error('Failed to create error window:', err);
    // Last resort: show dialog
    showErrorDialog('Critical Error', errorMessage, details);
  }
}

// Create the main window
function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        webSecurity: true
      },
      show: false // Don't show until ready
    });
  } catch (error) {
    const message = `Failed to create window: ${error.message}`;
    const details = error.stack;
    console.error(message);
    logToFile(`CRITICAL ERROR: ${message}\n${details}`);
    createErrorWindow(message, details);
    return;
  }

  // Load the frontend
  const frontendPath = getFrontendPath();
  
  logToFile(`Loading frontend from: ${frontendPath}`);
  
  // Debug: Log resources path and check what exists
  if (app.isPackaged) {
    logToFile(`Resources path: ${process.resourcesPath}`);
    try {
      const resourcesContents = fs.existsSync(process.resourcesPath) 
        ? fs.readdirSync(process.resourcesPath).join(', ')
        : 'DOES NOT EXIST';
      logToFile(`Resources directory contents: ${resourcesContents}`);
      
      const frontendDir = path.join(process.resourcesPath, 'frontend');
      if (fs.existsSync(frontendDir)) {
        const frontendContents = fs.readdirSync(frontendDir).join(', ');
        logToFile(`Frontend directory contents: ${frontendContents}`);
        
        const frontendDistDir = path.join(frontendDir, 'dist');
        if (fs.existsSync(frontendDistDir)) {
          const distContents = fs.readdirSync(frontendDistDir).join(', ');
          logToFile(`Frontend dist directory contents: ${distContents}`);
        } else {
          logToFile(`ERROR: Frontend dist directory does not exist: ${frontendDistDir}`);
        }
      } else {
        logToFile(`ERROR: Frontend directory does not exist: ${frontendDir}`);
      }
    } catch (err) {
      logToFile(`ERROR: Failed to read resources directory: ${err.message}`);
    }
  }
  
  // Check if frontend file exists (for file paths)
  if (!frontendPath.startsWith('http')) {
    if (!fs.existsSync(frontendPath)) {
      const message = `Frontend file not found: ${frontendPath}`;
      logToFile(`ERROR: ${message}`);
      
      // Provide more helpful error message
      let details = `Expected path: ${frontendPath}\n\n`;
      if (app.isPackaged) {
        details += `Resources path: ${process.resourcesPath}\n`;
        details += `Please verify that frontend/dist was included in the build.`;
      } else {
        details += `Please run "npm run build-frontend" to build the frontend.`;
      }
      
      showErrorDialog('Frontend Not Found', message, details);
      // Show window anyway so user can see the error
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
      }, 1000);
      return;
    }
  }
  
  if (frontendPath.startsWith('http')) {
    // Dev server URL
    logToFile('Loading from dev server URL');
    mainWindow.loadURL(frontendPath);
  } else {
    // File path - convert to file:// URL to ensure proper base path for relative assets
    // Using pathToFileURL ensures correct URL encoding and path resolution
    logToFile('Loading from file path');
    const fileUrl = pathToFileURL(frontendPath).href;
    logToFile(`Loading URL: ${fileUrl}`);
    mainWindow.loadURL(fileUrl);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      
      // Open DevTools in development
      if (isDev) {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // Fallback: show window after 5 seconds even if ready-to-show didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      logToFile('WARNING: Window not shown after ready-to-show event, forcing show');
      mainWindow.show();
    }
  }, 5000);
  
  // Allow toggling DevTools with F12 (useful for debugging in production)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Intercept navigation to prevent BrowserRouter from trying to navigate to file:// URLs
  // BrowserRouter doesn't work with file:// protocol, so we need to prevent invalid navigations
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    logToFile(`Navigation attempted to: ${navigationUrl}`);
    
    // If it's trying to navigate to a file:// URL that's not our frontend, block it
    if (navigationUrl.startsWith('file://')) {
      const frontendDir = path.dirname(frontendPath).replace(/\\/g, '/');
      const navigationDir = path.dirname(navigationUrl.replace('file:///', '').replace('file://', '')).replace(/\\/g, '/');
      
      // Allow navigation within the frontend directory
      if (!navigationUrl.includes(frontendDir) && !navigationUrl.match(/file:\/\/\/[A-Z]:\/home/)) {
        logToFile(`Blocking invalid navigation to: ${navigationUrl}`);
        event.preventDefault();
        return;
      }
      
      // Block navigation to invalid file:// paths like file:///C:/home
      if (navigationUrl.match(/file:\/\/\/[A-Z]:\/home/)) {
        logToFile(`Blocking invalid file:// navigation: ${navigationUrl}`);
        event.preventDefault();
        // Inject JavaScript to handle the route using hash-based navigation instead
        mainWindow.webContents.executeJavaScript(`
          if (window.location.hash !== '#/home') {
            window.location.hash = '/home';
          }
        `).catch(err => {
          logToFile(`Error executing navigation fix: ${err.message}`);
        });
        return;
      }
    }
  });

  // Handle loading errors (both main frame and sub-resources)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      // Main frame failed to load
      const message = `Failed to load frontend: ${errorCode} - ${errorDescription} (${validatedURL})`;
      logToFile(message);
      
      // Show error dialog for critical load failures
      if (errorCode !== -3) { // -3 is ABORTED, which is less critical
        showErrorDialog(
          'Failed to Load Application',
          message,
          `Frontend path: ${frontendPath}\n\nPlease check if the frontend is built correctly.`
        );
        
        // Show error in window if main window exists
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
          }
        }, 1000);
      }
    } else {
      // Sub-resource failed to load (JS, CSS, images, etc.)
      logToFile(`Failed to load resource: ${errorCode} - ${errorDescription} (${validatedURL})`);
      console.error(`[Resource Load Error] ${errorCode} - ${errorDescription}: ${validatedURL}`);
    }
  });

  // Log when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    logToFile('Frontend finished loading');
  });

  // Log console messages from renderer (including errors)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const logLevel = level === 0 ? 'DEBUG' : level === 1 ? 'INFO' : level === 2 ? 'WARN' : 'ERROR';
    logToFile(`[Renderer ${logLevel}] ${message} (${sourceId}:${line})`);
    if (level >= 2) { // WARN or ERROR
      console.error(`[Renderer ${logLevel}] ${message}`);
    }
  });

  // Log console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logToFile(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  const message = `Uncaught Exception: ${error.message}`;
  const details = error.stack || '';
  console.error(message);
  logToFile(`CRITICAL ERROR: ${message}\n${details}`);
  showErrorDialog('Application Error', message, details);
});

process.on('unhandledRejection', (reason, promise) => {
  const message = `Unhandled Rejection at: ${promise}, reason: ${reason}`;
  console.error(message);
  logToFile(`CRITICAL ERROR: ${message}`);
  showErrorDialog('Application Error', 'Unhandled Promise Rejection', message);
});

// App event handlers
app.whenReady().then(() => {
  logToFile('App ready, starting backend...');
  // Start backend first
  startBackend();
  
  // Wait a bit for backend to start, then create window
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  const message = `Failed to start app: ${error.message}`;
  const details = error.stack || '';
  console.error(message);
  logToFile(`CRITICAL ERROR: ${message}\n${details}`);
  showErrorDialog('Application Startup Failed', message, details);
  // Create error window as fallback
  setTimeout(() => {
    createErrorWindow(message, details);
  }, 1000);
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    stopBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('will-quit', () => {
  stopBackend();
});

// Handle app termination
process.on('SIGINT', () => {
  stopBackend();
  app.quit();
});

process.on('SIGTERM', () => {
  stopBackend();
  app.quit();
});
