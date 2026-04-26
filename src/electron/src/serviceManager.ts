import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import { app, utilityProcess } from 'electron';
import { PathResolver } from './pathResolver';
import { AppConfig } from './config';

type UtilityProcess = ReturnType<typeof utilityProcess.fork>;

/** Max time to wait for a process to exit before force-killing (ms) */
const PROCESS_EXIT_TIMEOUT_MS = 5000;
/** Max time to wait for ports to be released after killing processes (ms) */
const PORTS_RELEASE_TIMEOUT_MS = 10000;
/** Extra time after port-based kill (ms) */
const PORT_KILL_WAIT_MS = 3000;
/** Fast exit: max wait for process kill (ms) */
const EXIT_KILL_WAIT_MS = 1200;
/** Fast exit: short wait after port kill (ms) */
const EXIT_PORT_WAIT_MS = 400;

/**
 * Service Manager
 * Handles npm dependencies, building, and running services
 */

export interface ServiceStatus {
  running: boolean;
  port?: number;
  pid?: number;
}

export interface ProgressCallback {
  (message: string, percent: number): void;
}

export class ServiceManager {
  private pathResolver: PathResolver;
  private config: AppConfig;

  // ── Dev-mode processes (git-cloned repos) ─────────────────────────────────
  private backendProcess?: ChildProcess;
  private frontendProcess?: ChildProcess;

  // ── Packaged-mode processes (bundled extraResources) ──────────────────────
  /**
   * Backend subprocess started via utilityProcess.fork() in packaged mode.
   * Uses Electron's own bundled Node.js — no system Node.js required on the
   * customer's machine.
   */
  private bundledBackendProcess?: UtilityProcess;
  /** Lightweight HTTP server serving the pre-built Vite static frontend */
  private staticFrontendServer?: http.Server;

  // ── Runtime ports (may differ from config if preferred port was busy) ──────
  /** Actual port the backend is listening on (0 = not started yet) */
  private runtimeBackendPort = 0;
  /** Actual port the static frontend server is listening on (0 = not started yet) */
  private runtimeFrontendPort = 0;
  
  constructor(pathResolver: PathResolver, config: AppConfig) {
    this.pathResolver = pathResolver;
    this.config = config;
  }

  /** Returns the actual backend port (preferred config port if not yet started). */
  getBackendPort(): number {
    return this.runtimeBackendPort || this.config.backendPort;
  }

  /** Returns the actual frontend port (preferred config port if not yet started). */
  getFrontendPort(): number {
    return this.runtimeFrontendPort || this.config.frontendPort;
  }
  
  /**
   * Check if a port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  }
  
  /**
   * Find a free TCP port starting from `preferred`.
   * Scans preferred → preferred+99 first, then falls back to an OS-assigned
   * ephemeral port so startup never blocks on a permanently occupied port.
   */
  async findFreePort(preferred: number): Promise<number> {
    for (let p = preferred; p < preferred + 100; p++) {
      if (await this.isPortAvailable(p)) return p;
    }
    return new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address() as net.AddressInfo;
        const port = addr.port;
        s.close(() => resolve(port));
      });
      s.on('error', reject);
    });
  }

  /**
   * Wait for a port to become active
   */
  async waitForPort(port: number, timeoutMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    let attempts = 0;
    
    while (Date.now() - startTime < timeoutMs) {
      attempts++;
      
      // Try to connect to the port directly
      const isListening = await this.checkPortListening(port);
      if (isListening) {
        console.log(`✅ Port ${port} is active after ${attempts} attempts`);
        return true;
      }
      
      if (attempts % 5 === 0) {
        console.log(`Still waiting for port ${port}... (attempt ${attempts})`);
      }
      
      // Wait 2 seconds before checking again (give more time for Vite to start)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.error(`❌ Timeout waiting for port ${port} after ${attempts} attempts`);
    return false;
  }
  
  /**
   * Check if a port is actually listening by attempting to connect
   * Uses both TCP socket and HTTP request for reliability
   */
  private async checkPortListening(port: number): Promise<boolean> {
    // Try HTTP request first (more reliable for web servers like Vite)
    const httpCheck = await this.checkHttpServer(port);
    if (httpCheck) {
      return true;
    }
    
    // Fall back to TCP socket check
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      socket.setTimeout(2000);
      
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.connect(port, 'localhost');
    });
  }
  
  /**
   * Check if an HTTP server is responding on the port
   */
  private async checkHttpServer(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/',
        method: 'GET',
        timeout: 2000,
      };
      
      const req = http.request(options, (res) => {
        // Any response means the server is up
        resolve(true);
        req.destroy();
      });
      
      req.on('error', () => {
        resolve(false);
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    });
  }
  
  /**
   * Check if package.json has changed
   */
  private hasPackageJsonChanged(projectPath: string): boolean {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const lockPath = path.join(projectPath, 'package-lock.json');
    const timestampPath = path.join(projectPath, '.last-install');
    
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }
    
    if (!fs.existsSync(timestampPath)) {
      return true;
    }
    
    const packageJsonTime = fs.statSync(packageJsonPath).mtimeMs;
    const lastInstallTime = parseFloat(fs.readFileSync(timestampPath, 'utf-8'));
    
    if (packageJsonTime > lastInstallTime) {
      return true;
    }
    
    if (fs.existsSync(lockPath)) {
      const lockTime = fs.statSync(lockPath).mtimeMs;
      if (lockTime > lastInstallTime) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Mark package.json as installed
   */
  private markPackageInstalled(projectPath: string): void {
    const timestampPath = path.join(projectPath, '.last-install');
    fs.writeFileSync(timestampPath, Date.now().toString());
  }
  
  /**
   * Install npm dependencies
   */
  async installDependencies(projectPath: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing dependencies...', 0);
    
    if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
      throw new Error(`No package.json found in ${projectPath}`);
    }
    
    // Check if installation is needed
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    const needsInstall = !fs.existsSync(nodeModulesPath) || this.hasPackageJsonChanged(projectPath);
    
    if (!needsInstall) {
      onProgress?.('Dependencies already up to date', 100);
      return;
    }
    
    return new Promise((resolve, reject) => {
      const npmProcess = spawn('npm', ['install'], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: {
          ...this.pathResolver.getEnvWithPortablePaths(),
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        },
      });
      
      let output = '';
      let lastProgress = 0;
      
      const updateProgress = (data: string) => {
        output += data;
        
        // Detect Playwright browser download
        if (data.includes('Downloading') && data.includes('playwright')) {
          onProgress?.('Downloading Chromium browser for WhatsApp automation...', 50);
          return;
        }
        
        // Estimate progress based on output
        const lines = output.split('\n').length;
        const estimatedProgress = Math.min(90, 20 + lines * 2);
        
        if (estimatedProgress > lastProgress) {
          lastProgress = estimatedProgress;
          onProgress?.(`Installing dependencies... (${estimatedProgress}%)`, estimatedProgress);
        }
      };
      
      npmProcess.stdout.on('data', (data) => {
        updateProgress(data.toString());
      });
      
      npmProcess.stderr.on('data', (data) => {
        updateProgress(data.toString());
      });
      
      npmProcess.on('close', async (code) => {
        if (code === 0) {
          this.markPackageInstalled(projectPath);
          
          // Check if Playwright is installed and install browsers if needed
          const packageJsonPath = path.join(projectPath, 'package.json');
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const hasPlaywright = packageJson.dependencies?.playwright || packageJson.devDependencies?.playwright;
          
          if (hasPlaywright) {
            try {
              onProgress?.('Installing Chromium browser for WhatsApp automation...', 95);
              await this.installPlaywrightBrowsers(projectPath, onProgress);
            } catch (error) {
              console.error('Failed to install Playwright browsers:', error);
              // Don't fail the entire installation if browser download fails
            }
          }
          
          onProgress?.('Dependencies installed successfully', 100);
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}: ${output}`));
        }
      });
      
      npmProcess.on('error', (err) => {
        reject(new Error(`Failed to run npm install: ${err.message}`));
      });
    });
  }
  
  /**
   * Install Playwright browsers (Chromium only for WhatsApp automation)
   */
  private async installPlaywrightBrowsers(projectPath: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      // Install only Chromium to save space and time
      const playwrightProcess = spawn('npx', ['playwright', 'install', 'chromium', '--with-deps'], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      
      let output = '';
      
      playwrightProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('[Playwright Install]', text.trim());
        
        // Update progress message based on output
        if (text.includes('Downloading')) {
          onProgress?.('Downloading Chromium (~100MB)...', 96);
        } else if (text.includes('Installing')) {
          onProgress?.('Installing Chromium dependencies...', 97);
        }
      });
      
      playwrightProcess.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('[Playwright Install]', text.trim());
      });
      
      playwrightProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Chromium browser installed successfully');
          onProgress?.('Chromium browser installed', 98);
          resolve();
        } else {
          console.error('❌ Playwright browser installation failed:', output);
          reject(new Error(`Playwright install failed with code ${code}: ${output}`));
        }
      });
      
      playwrightProcess.on('error', (err) => {
        reject(new Error(`Failed to run playwright install: ${err.message}`));
      });
    });
  }
  
  /**
   * Rebuild native Node modules (e.g. @tailwindcss/oxide) for current platform.
   * Fixes "The specified module could not be found" on Windows when VC++ runtime is present
   * but the native addon was not built correctly.
   */
  private async rebuildNativeModules(projectPath: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const rebuildProcess = spawn('npm', ['rebuild'], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      let output = '';
      rebuildProcess.stdout?.on('data', (data) => { output += data.toString(); });
      rebuildProcess.stderr?.on('data', (data) => { output += data.toString(); });
      rebuildProcess.on('close', (code) => {
        if (code === 0) {
          onProgress?.('Native modules rebuilt', 30);
          resolve();
        } else {
          reject(new Error(`npm rebuild failed with code ${code}: ${output}`));
        }
      });
      rebuildProcess.on('error', (err) => reject(err));
    });
  }
  
  /**
   * Build a project
   */
  async buildProject(projectPath: string, buildCommand: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Building project...', 0);
    
    if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
      throw new Error(`No package.json found in ${projectPath}`);
    }
    
    return new Promise((resolve, reject) => {
      const [command, ...args] = buildCommand.split(' ');
      const buildProcess = spawn(command, args, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      
      let output = '';
      let lastProgress = 0;
      
      const updateProgress = (data: string) => {
        output += data;
        
        // Estimate progress based on output
        const lines = output.split('\n').length;
        const estimatedProgress = Math.min(90, 10 + lines * 3);
        
        if (estimatedProgress > lastProgress) {
          lastProgress = estimatedProgress;
          onProgress?.(`Building... (${estimatedProgress}%)`, estimatedProgress);
        }
      };
      
      buildProcess.stdout.on('data', (data) => {
        updateProgress(data.toString());
      });
      
      buildProcess.stderr.on('data', (data) => {
        updateProgress(data.toString());
      });
      
      buildProcess.on('close', (code) => {
        if (code === 0) {
          onProgress?.('Build completed successfully', 100);
          resolve();
        } else {
          const isTailwindOxideError =
            output.includes('tailwindcss-oxide') ||
            output.includes('@tailwindcss/oxide') ||
            (output.includes('The specified module could not be found') && output.includes('.node'));
          const hint = isTailwindOxideError && os.platform() === 'win32'
            ? '\n\nWindows fix: Install "Microsoft Visual C++ Redistributable" (latest) from https://aka.ms/vs/17/release/vc_redist.x64.exe then restart the app and try again.'
            : '';
          reject(new Error(`Build failed with code ${code}: ${output}${hint}`));
        }
      });
      
      buildProcess.on('error', (err) => {
        reject(new Error(`Failed to run build command: ${err.message}`));
      });
    });
  }
  
  /**
   * Start a service
   */
  async startService(
    projectPath: string,
    startCommand: string,
    port: number,
    serviceName: string,
    onProgress?: ProgressCallback
  ): Promise<ChildProcess> {
    onProgress?.(`Starting ${serviceName}...`, 0);
    
    if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
      throw new Error(`No package.json found in ${projectPath}`);
    }
    
    // If the port is still occupied (race condition between findFreePort and now),
    // just scan for the next free one instead of killing whatever holds it.
    // The server process has its own findFreePort fallback and will announce the
    // actual port it binds to via stdout (BILLBOOK_BACKEND_PORT=<port>), so
    // waitForPort will automatically track the right port.
    if (!(await this.isPortAvailable(port))) {
      console.warn(`[ServiceManager] Port ${port} no longer free (race condition) — finding next free port for ${serviceName}...`);
      port = await this.findFreePort(port + 1);
      console.log(`[ServiceManager] ${serviceName} will use port ${port}`);
    }

    // Replace $PORT placeholder with actual port value
    const commandWithPort = startCommand.replace(/\$PORT/g, port.toString());
    
    // Prepare environment variables
    // Note: We need to be explicit about which vars to pass
    // to avoid passing Electron-specific vars that might confuse child processes
    const serviceEnv = {
      ...this.pathResolver.getEnvWithPortablePaths(),
      PORT: port.toString(),
      NODE_ENV: 'production',
      FORCE_COLOR: '1',
    };
    
    console.log(`\n=== STARTING ${serviceName.toUpperCase()} SERVICE ===`);
    console.log('Working Directory:', projectPath);
    console.log('Original Command:', startCommand);
    console.log('Command After $PORT Substitution:', commandWithPort);
    console.log('Target Port:', port);
    console.log('\n🔧 Environment Variables Passed to Process:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Log all environment variables (filter sensitive ones)
    Object.keys(serviceEnv).sort().forEach(key => {
      // Skip very long values and sensitive data
      const value = (serviceEnv as any)[key] || '';
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('key')) {
        console.log(`  ${key}: [REDACTED]`);
      } else if (value.length > 100) {
        console.log(`  ${key}: ${value.substring(0, 100)}...`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('=====================================\n');
    
    const [command, ...args] = commandWithPort.split(' ');
    const serviceProcess = spawn(command, args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: false,
      env: serviceEnv,
    });
    
    // Log output to file
    const logPath = this.pathResolver.getLogFilePath(serviceName);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // Watch stdout for a port announcement emitted by the service itself.
    // The whatsapp_automation server writes `BILLBOOK_BACKEND_PORT=<port>` to
    // stdout when it successfully binds — this handles the case where the server
    // chose a different port because the preferred one was busy.
    let announcedPort: number | null = null;
    const announcedPortPromise = new Promise<number | null>((resolve) => {
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/BILLBOOK_BACKEND_PORT=(\d+)/);
        if (match) {
          const p = parseInt(match[1], 10);
          announcedPort = p;
          resolve(p);
        }
      };
      serviceProcess.stdout?.on('data', onData);
      // If no announcement arrives within 8 seconds, fall back to the
      // configured port (e.g. Vite / other services that don't emit the token)
      setTimeout(() => resolve(null), 8_000);
    });

    // Now pipe to log file (adding the data listener above doesn't block piping)
    serviceProcess.stdout.pipe(logStream);
    serviceProcess.stderr.pipe(logStream);
    
    serviceProcess.on('error', (err) => {
      console.error(`${serviceName} error:`, err);
    });
    
    serviceProcess.on('close', (code) => {
      console.log(`${serviceName} exited with code ${code}`);
    });
    
    onProgress?.(`${serviceName} starting, waiting for port ${port}...`, 50);

    // Resolve the port we actually need to wait for.
    // If the service announced a different port (e.g. fallback due to conflict),
    // use that; otherwise use the port Electron chose.
    const announced = await announcedPortPromise;
    const effectivePort = announced ?? port;

    if (announced !== null && announced !== port) {
      console.log(`[ServiceManager] ${serviceName} announced port ${announced} (expected ${port}) — updating runtime port`);
      if (serviceName === 'backend') this.runtimeBackendPort = announced;
      if (serviceName === 'frontend') this.runtimeFrontendPort = announced;
    }
    
    // Wait for service to be ready
    const ready = await this.waitForPort(effectivePort, 60000);
    if (!ready) {
      serviceProcess.kill();
      throw new Error(`${serviceName} failed to start on port ${effectivePort}`);
    }
    
    onProgress?.(`${serviceName} started successfully on port ${effectivePort}`, 100);
    
    return serviceProcess;
  }
  
  /**
   * Start the esbuild-bundled backend (server.js) using Electron's own built-in
   * Node.js runtime via utilityProcess.fork().
   *
   * Why not spawn('node', ...)?
   *   spawn() would call the SYSTEM node binary, which may not exist on the
   *   customer's machine. utilityProcess.fork() uses the Node.js runtime that
   *   Electron itself ships with — no external Node.js installation required.
   *
   * Available since Electron 22; cwd option available since Electron 28.
   */
  private async startBackendWithUtilityProcess(
    backendDistPath: string,
    port: number,
    onProgress?: ProgressCallback,
  ): Promise<UtilityProcess> {
    onProgress?.('Starting backend…', 0);

    // If the port is still occupied (race condition between findFreePort and now),
    // scan for the next free one — never kill whatever holds it.
    if (!(await this.isPortAvailable(port))) {
      console.warn(`[Backend] Port ${port} no longer free (race condition) — finding next free port…`);
      port = await this.findFreePort(port + 1);
      console.log(`[Backend] Will use port ${port} instead`);
    }

    const serverScript = path.join(backendDistPath, 'server.js');
    const logPath = this.pathResolver.getLogFilePath('backend');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    console.log('[Backend] Starting via utilityProcess.fork():', serverScript);

      const child = utilityProcess.fork(serverScript, [], {
      // Electron 28+ supports cwd — runs the script in its own directory so
      // relative requires inside server.js resolve correctly.
      cwd: backendDistPath,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        // WhatsApp session data (QR code login) — persisted across restarts
        USER_DATA_DIR: path.join(this.pathResolver.getUserDataPath(), 'whatsapp-session'),
        // Playwright browser cache — only used if Chrome/Edge not found on system
        PLAYWRIGHT_BROWSERS_PATH: path.join(
          this.pathResolver.getUserDataPath(),
          'chromium-browsers',
        ),
      },
      // 'pipe' lets us capture stdout/stderr for log files
      stdio: 'pipe',
      serviceName: 'BillBook-Backend',
    });

    // Pipe output to log file
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    child.on('exit', (code) => {
      console.log(`[Backend] utilityProcess exited with code ${code}`);
      logStream.end();
    });

    onProgress?.(`Waiting for backend on port ${port}…`, 50);

    const ready = await this.waitForPort(port, 60_000);
    if (!ready) {
      child.kill();
      throw new Error(`Backend failed to start on port ${port}. Check logs at: ${logPath}`);
    }

    onProgress?.(`Backend running on port ${port}`, 100);
    return child;
  }

  /**
   * V2: Kill process and its entire tree so that all bound ports are released.
   * On Windows uses taskkill /T /F to kill child processes (e.g. node/npm).
   */
  private killProcessTree(proc: ChildProcess): void {
    if (!proc || !proc.pid) return;
    const pid = proc.pid;
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
      } else {
        try {
          proc.kill('SIGTERM');
        } catch {}
      }
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }
  }

  /**
   * V2: Stop a single service and ensure its process (and children) exit so ports are closed.
   * Returns a promise that resolves when the process has exited or after timeout.
   */
  private stopServiceAndWait(process?: ChildProcess): Promise<void> {
    if (!process || process.killed) return Promise.resolve();
    return new Promise((resolve) => {
      const pid = process.pid;
      const timeout = setTimeout(() => {
        if (!process.killed) {
          try {
            this.killProcessTree(process);
          } catch {}
        }
        resolve();
      }, PROCESS_EXIT_TIMEOUT_MS);
      process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.killProcessTree(process);
    });
  }

  /**
   * Stop a service (legacy sync API; prefer stopAllServicesAsync for clean quit)
   */
  stopService(process?: ChildProcess): void {
    if (process && !process.killed) {
      this.killProcessTree(process);
      setTimeout(() => {
        if (process && !process.killed) {
          try {
            process.kill('SIGKILL');
          } catch {}
        }
      }, PROCESS_EXIT_TIMEOUT_MS);
    }
  }

  /**
   * Get PIDs of processes listening on the given port.
   * Windows: PowerShell Get-NetTCPConnection then netstat. Unix: lsof -i :PORT -t.
   */
  private getPidsOnPort(port: number): number[] {
    const myPid = process.pid;
    const pids = new Set<number>();

    if (os.platform() === 'win32') {
      try {
        const psOut = execSync(
          `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
        );
        for (const s of psOut.split(/\r?\n/)) {
          const pid = parseInt(s.trim(), 10);
          if (!isNaN(pid) && pid > 0 && pid !== myPid) pids.add(pid);
        }
      } catch {}

      if (pids.size > 0) return [...pids];

      try {
        const out = execSync('netstat -ano', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        for (const line of out.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.includes('LISTENING')) continue;
          if (!trimmed.includes(':' + port)) continue;
          const parts = trimmed.split(/\s+/).filter(Boolean);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0 && pid !== myPid) pids.add(pid);
        }
      } catch {}
      return [...pids];
    }

    // Unix (darwin, linux): lsof -i :PORT -t
    try {
      const out = execSync(`lsof -i :${port} -t`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      for (const s of out.split(/\r?\n/)) {
        const pid = parseInt(s.trim(), 10);
        if (!isNaN(pid) && pid > 0 && pid !== myPid) pids.add(pid);
      }
    } catch {}
    return [...pids];
  }

  /**
   * Kill any process listening on the given port.
   * Windows: taskkill. Unix: kill -9.
   */
  private killProcessesOnPort(port: number): void {
    const pids = this.getPidsOnPort(port);
    for (const pid of pids) {
      try {
        if (os.platform() === 'win32') {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore', windowsHide: true });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {}
    }
  }

  /**
   * Called on app exit: ensure no processes remain on backend and frontend ports (e.g. 4242, 5173).
   * Kills any PIDs found on those ports so they are released.
   */
  async killProcessesOnPortsForExit(): Promise<void> {
    const backendPort = this.getBackendPort();
    const frontendPort = this.getFrontendPort();
    this.killProcessesOnPort(backendPort);
    this.killProcessesOnPort(frontendPort);
    await new Promise((r) => setTimeout(r, PORT_KILL_WAIT_MS));
    this.killProcessesOnPort(backendPort);
    this.killProcessesOnPort(frontendPort);
  }

  /**
   * Fast exit: kill backend and frontend immediately, kill by port, short wait.
   * Use this when the user clicks Exit so the app closes in ~1–2 seconds.
   */
  async stopAllServicesForExit(): Promise<void> {
    const backendPort = this.getBackendPort();
    const frontendPort = this.getFrontendPort();
    console.log('[V2] Stopping services (fast exit)...');

    // Packaged mode: kill utilityProcess backend + close static HTTP server
    if (this.bundledBackendProcess) {
      try { this.bundledBackendProcess.kill(); } catch {}
      this.bundledBackendProcess = undefined;
    }
    if (this.staticFrontendServer) {
      this.staticFrontendServer.close();
      this.staticFrontendServer = undefined;
    }

    // Dev mode: kill child processes
    if (this.frontendProcess) this.killProcessTree(this.frontendProcess);
    if (this.backendProcess) this.killProcessTree(this.backendProcess);
    this.backendProcess = undefined;
    this.frontendProcess = undefined;

    await new Promise((r) => setTimeout(r, EXIT_KILL_WAIT_MS));
    this.killProcessesOnPort(frontendPort);
    this.killProcessesOnPort(backendPort);
    await new Promise((r) => setTimeout(r, EXIT_PORT_WAIT_MS));
    console.log('[V2] Fast exit done');
  }

  /**
   * V2: Stop all services, ensure process trees are killed and ports are released.
   * On Windows, also kills by port so the frontend and backend ports are always freed.
   */
  async stopAllServicesAsync(): Promise<void> {
    // Packaged mode: kill utilityProcess backend + close static HTTP server
    if (this.bundledBackendProcess) {
      try { this.bundledBackendProcess.kill(); } catch {}
      this.bundledBackendProcess = undefined;
    }
    if (this.staticFrontendServer) {
      this.staticFrontendServer.close();
      this.staticFrontendServer = undefined;
    }
    const backendPort = this.getBackendPort();
    const frontendPort = this.getFrontendPort();

    console.log('[V2] Stopping services and closing ports...');
    await this.stopServiceAndWait(this.frontendProcess);
    await this.stopServiceAndWait(this.backendProcess);
    this.backendProcess = undefined;
    this.frontendProcess = undefined;

    this.killProcessesOnPort(frontendPort);
    this.killProcessesOnPort(backendPort);
    await new Promise((r) => setTimeout(r, PORT_KILL_WAIT_MS));
    this.killProcessesOnPort(frontendPort);
    await new Promise((r) => setTimeout(r, 1000));

    const deadline = Date.now() + PORTS_RELEASE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const backendFree = await this.isPortAvailable(backendPort);
      const frontendFree = await this.isPortAvailable(frontendPort);
      if (backendFree && frontendFree) {
        console.log(`[V2] Ports closed: backend ${backendPort}, frontend ${frontendPort}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    this.killProcessesOnPort(frontendPort);
    this.killProcessesOnPort(backendPort);
    await new Promise((r) => setTimeout(r, PORT_KILL_WAIT_MS));
    const b = await this.isPortAvailable(backendPort);
    const f = await this.isPortAvailable(frontendPort);
    if (b && f) {
      console.log(`[V2] Ports closed: backend ${backendPort}, frontend ${frontendPort}`);
    } else {
      console.warn(`[V2] Ports may still be in use: backend ${backendPort}, frontend ${frontendPort}`);
    }
  }

  /**
   * Stop all services (sync; does not wait for ports)
   */
  stopAllServices(): void {
    this.stopService(this.backendProcess);
    this.stopService(this.frontendProcess);
    this.backendProcess = undefined;
    this.frontendProcess = undefined;
  }
  
  /**
   * Setup and start backend service
   */
  async startBackend(onProgress?: ProgressCallback): Promise<void> {
    const backendPath = this.pathResolver.getBackendPath();
    
    // Install dependencies
    onProgress?.('Installing backend dependencies...', 0);
    await this.installDependencies(backendPath, (msg, percent) => {
      onProgress?.(msg, percent * 0.3);
    });
    
    // Build backend if build command is provided
    if (this.config.backendBuildCommand) {
      onProgress?.('Building backend...', 30);
      await this.buildProject(backendPath, this.config.backendBuildCommand, (msg, percent) => {
        onProgress?.(msg, 30 + percent * 0.4);
      });
    }
    
    // Start service
    const startPercent = this.config.backendBuildCommand ? 70 : 30;
    onProgress?.('Starting backend service...', startPercent);
    this.backendProcess = await this.startService(
      backendPath,
      this.config.backendStartCommand,
      this.config.backendPort,
      'backend',
      (msg, percent) => {
        onProgress?.(msg, startPercent + percent * 0.3);
      }
    );
  }
  
  /**
   * Create .env.production file for frontend
   */
  private createFrontendEnvFile(frontendPath: string): void {
    const envProductionPath = path.join(frontendPath, '.env.production');
    
    // Start with default environment variables
    let envContent = `# Auto-generated by Electron app
# This file is created locally and not committed to git
# Last updated: ${new Date().toISOString()}

# Backend API URL
VITE_API_URL=http://localhost:${this.config.backendPort}

# App Configuration
VITE_APP_NAME=${this.config.appName}
VITE_APP_ENV=production

# Ports (for reference)
VITE_BACKEND_PORT=${this.config.backendPort}
VITE_FRONTEND_PORT=${this.config.frontendPort}
`;
    
    // Add custom environment variables from config
    if (this.config.frontendEnv && Object.keys(this.config.frontendEnv).length > 0) {
      envContent += '\n# Custom environment variables\n';
      Object.entries(this.config.frontendEnv).forEach(([key, value]) => {
        envContent += `${key}=${value}\n`;
      });
    }
    
    try {
      fs.writeFileSync(envProductionPath, envContent, 'utf-8');
      console.log('✅ Created .env.production file');
      console.log('📄 Content:');
      console.log(envContent);
    } catch (error) {
      console.error('❌ Failed to create .env.production:', error);
    }
  }
  
  /**
   * Setup and start frontend service
   */
  async startFrontend(onProgress?: ProgressCallback): Promise<void> {
    const frontendPath = this.pathResolver.getFrontendPath();
    
    console.log('\n=== FRONTEND CONFIGURATION ===');
    console.log('Frontend Path:', frontendPath);
    console.log('Frontend Port:', this.config.frontendPort);
    console.log('Frontend Build Command:', this.config.frontendBuildCommand);
    console.log('Frontend Start Command:', this.config.frontendStartCommand);
    console.log('Complete Config:', JSON.stringify(this.config, null, 2));
    
    // Create .env.production file
    console.log('\n📝 Creating production environment file...');
    this.createFrontendEnvFile(frontendPath);
    
    // Check for .env files in frontend
    console.log('\n📄 Frontend .env Files:');
    const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
    envFiles.forEach(envFile => {
      const envPath = path.join(frontendPath, envFile);
      if (fs.existsSync(envPath)) {
        console.log(`\n  ✓ Found: ${envFile}`);
        try {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          console.log('  Contents:');
          envContent.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
              // Redact sensitive values
              if (line.toLowerCase().includes('token') || line.toLowerCase().includes('secret') || line.toLowerCase().includes('key')) {
                const [key] = line.split('=');
                console.log(`    ${key}=[REDACTED]`);
              } else {
                console.log(`    ${line}`);
              }
            }
          });
        } catch (err) {
          console.log(`    Error reading file: ${err}`);
        }
      } else {
        console.log(`  ✗ Not found: ${envFile}`);
      }
    });
    
    console.log('==============================\n');
    
    // Install dependencies
    onProgress?.('Installing frontend dependencies...', 0);
    await this.installDependencies(frontendPath, (msg, percent) => {
      onProgress?.(msg, percent * 0.3);
    });
    
    // On Windows, rebuild native modules (fixes Tailwind @tailwindcss/oxide load errors)
    if (os.platform() === 'win32') {
      try {
        onProgress?.('Rebuilding native modules (Tailwind/Windows)...', 28);
        await this.rebuildNativeModules(frontendPath, onProgress);
      } catch (rebuildErr) {
        console.warn('Native rebuild failed (non-fatal):', rebuildErr);
        // Continue with build; rebuild is best-effort
      }
    }
    
    // Build
    onProgress?.('Building frontend...', 30);
    await this.buildProject(frontendPath, this.config.frontendBuildCommand, (msg, percent) => {
      onProgress?.(msg, 30 + percent * 0.4);
    });
    
    // Start service
    onProgress?.('Starting frontend service...', 70);
    console.log(`\n>>> Starting frontend with command: ${this.config.frontendStartCommand}`);
    console.log(`>>> Expected to listen on port: ${this.config.frontendPort}`);
    this.frontendProcess = await this.startService(
      frontendPath,
      this.config.frontendStartCommand,
      this.config.frontendPort,
      'frontend',
      (msg, percent) => {
        onProgress?.(msg, 70 + percent * 0.3);
      }
    );
  }
  
  /**
   * Start all services (install deps, build, then start) - use for first-time setup.
   */
  async startAllServices(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Starting services...', 0);
    onProgress?.('Preparing backend...', 10);
    await this.startBackend((msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.4);
    });
    onProgress?.('Preparing frontend...', 50);
    await this.startFrontend((msg, percent) => {
      onProgress?.(msg, 50 + percent * 0.4);
    });
    onProgress?.('All services running', 100);
  }

  /**
   * Serve the pre-built Vite static files from extraResources/frontend on a local HTTP port.
   * Used in packaged (production) mode instead of spawning Vite/serve as a child process.
   * Handles SPA routing by falling back to index.html for unknown paths.
   */
  /**
   * Serve the pre-built Vite static files from extraResources/frontend on a local HTTP port.
   * Used in packaged (production) mode instead of spawning Vite/serve as a child process.
   * Handles SPA routing by falling back to index.html for unknown paths.
   *
   * index.html responses are modified to inject a tiny inline script that sets
   * `window.__ELECTRON_CONFIG__` so the frontend can read the actual runtime
   * backend port without any IPC round-trip.
   */
  private startStaticServer(staticDir: string, port: number, backendPort: number): Promise<http.Server> {
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js':   'application/javascript',
      '.mjs':  'application/javascript',
      '.css':  'text/css',
      '.json': 'application/json',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif':  'image/gif',
      '.svg':  'image/svg+xml',
      '.ico':  'image/x-icon',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2':'font/woff2',
      '.ttf':  'font/ttf',
      '.eot':  'application/vnd.ms-fontobject',
      '.map':  'application/json',
    };

    // Injected into every index.html response so the frontend knows the actual
    // backend port at runtime — works even when the port differs from the default.
    const configScript = `<script>window.__ELECTRON_CONFIG__=${JSON.stringify({ backendPort })};</script>`;

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        let filePath = path.join(staticDir, urlPath);

        // Resolve directories to index.html
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(staticDir, 'index.html');
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';

        // Cache immutable hashed assets for 1 year; never cache HTML (SPA entry point)
        const cacheControl = ext === '.html'
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000, immutable';

        // Inject runtime config into HTML so the renderer gets the actual ports
        if (ext === '.html') {
          try {
            let html = fs.readFileSync(filePath, 'utf-8');
            // Prefer injecting right after <head>; fall back to prepending <script>
            html = html.includes('<head>')
              ? html.replace('<head>', `<head>${configScript}`)
              : `${configScript}${html}`;
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', cacheControl);
            res.end(html, 'utf-8');
            return;
          } catch (err) {
            console.error('[StaticServer] Failed to inject config into HTML:', err);
            // Fall through to stream the file as-is
          }
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', cacheControl);

        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        });
        stream.pipe(res);
      });

      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        console.log(`[StaticServer] Serving ${staticDir} on port ${port} (backend port: ${backendPort})`);
        resolve(server);
      });
    });
  }

  /**
   * V2: Start backend process only (no install, no build).
   *
   * - Packaged: uses utilityProcess.fork() with Electron's own Node.js runtime —
   *   no system Node.js required on the customer's machine.
   * - Dev: uses the configured backendStartCommand from the git-cloned repo.
   */
  async startBackendOnly(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Starting backend...', 0);

    const port = await this.findFreePort(this.config.backendPort);
    this.runtimeBackendPort = port;
    if (port !== this.config.backendPort) {
      console.log(`[ServiceManager] Backend preferred port ${this.config.backendPort} busy → using ${port}`);
    }

    if (app.isPackaged) {
      // Packaged production mode: use Electron's built-in Node.js to run server.js
      const backendDistPath = this.pathResolver.getBundledBackendPath();
      this.bundledBackendProcess = await this.startBackendWithUtilityProcess(
        backendDistPath,
        port,
        (msg, percent) => onProgress?.(msg, percent),
      );
    } else {
      // Dev mode: start from the git-cloned repo using system node/npm
      const backendPath = this.pathResolver.getBackendPath();
      this.backendProcess = await this.startService(
        backendPath,
        this.config.backendStartCommand,
        port,
        'backend',
        (msg, percent) => onProgress?.(msg, percent),
      );
    }

    onProgress?.('Backend running', 100);
  }

  /**
   * V2: Start frontend process only.
   * - Packaged: starts a lightweight static HTTP server on the configured port.
   * - Dev: creates .env.production and starts the configured frontend start command.
   */
  async startFrontendOnly(onProgress?: ProgressCallback): Promise<void> {
    const isPackaged = app.isPackaged;

    const port = await this.findFreePort(this.config.frontendPort);
    this.runtimeFrontendPort = port;
    if (port !== this.config.frontendPort) {
      console.log(`[ServiceManager] Frontend preferred port ${this.config.frontendPort} busy → using ${port}`);
    }

    if (isPackaged) {
      const frontendPath = this.pathResolver.getBundledFrontendPath();
      onProgress?.('Starting frontend (static server)...', 0);
      // Pass the actual backend port so it can be injected into index.html at serve time
      this.staticFrontendServer = await this.startStaticServer(frontendPath, port, this.getBackendPort());
      onProgress?.('Frontend running', 100);
      return;
    }

    const frontendPath = this.pathResolver.getFrontendPath();
    this.createFrontendEnvFile(frontendPath);
    onProgress?.('Starting frontend...', 0);
    this.frontendProcess = await this.startService(
      frontendPath,
      this.config.frontendStartCommand,
      port,
      'frontend',
      (msg, percent) => onProgress?.(msg, percent),
    );
    onProgress?.('Frontend running', 100);
  }

  /**
   * V2: Start backend and frontend processes only (no install, no build). Use after first-time setup.
   */
  async startAllServicesOnly(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Starting backend and frontend...', 0);
    const backendPath = this.pathResolver.getBackendPath();
    const frontendPath = this.pathResolver.getFrontendPath();

    const backendPort = await this.findFreePort(this.config.backendPort);
    this.runtimeBackendPort = backendPort;
    const frontendPort = await this.findFreePort(this.config.frontendPort);
    this.runtimeFrontendPort = frontendPort;

    this.createFrontendEnvFile(frontendPath);

    onProgress?.('Starting backend...', 20);
    this.backendProcess = await this.startService(
      backendPath,
      this.config.backendStartCommand,
      backendPort,
      'backend',
      (msg, percent) => onProgress?.(msg, 20 + percent * 0.3),
    );
    onProgress?.('Starting frontend...', 50);
    this.frontendProcess = await this.startService(
      frontendPath,
      this.config.frontendStartCommand,
      frontendPort,
      'frontend',
      (msg, percent) => onProgress?.(msg, 50 + percent * 0.5),
    );
    onProgress?.('All services running', 100);
  }
  
  /**
   * Get service status
   */
  getBackendStatus(): ServiceStatus {
    if (app.isPackaged) {
      return {
        running: this.bundledBackendProcess !== undefined,
        port: this.config.backendPort,
        pid: this.bundledBackendProcess?.pid,
      };
    }
    return {
      running: this.backendProcess !== undefined && !this.backendProcess.killed,
      port: this.config.backendPort,
      pid: this.backendProcess?.pid,
    };
  }
  
  getFrontendStatus(): ServiceStatus {
    return {
      running: this.frontendProcess !== undefined && !this.frontendProcess.killed,
      port: this.config.frontendPort,
      pid: this.frontendProcess?.pid,
    };
  }
}
