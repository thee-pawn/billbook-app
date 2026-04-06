import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import { PathResolver } from './pathResolver';
import { AppConfig } from './config';

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
  private backendProcess?: ChildProcess;
  private frontendProcess?: ChildProcess;
  
  constructor(pathResolver: PathResolver, config: AppConfig) {
    this.pathResolver = pathResolver;
    this.config = config;
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
    
    let portAvailable = await this.isPortAvailable(port);
    if (!portAvailable) {
      console.warn(`[V2] Port ${port} in use; attempting to free it for ${serviceName}...`);
      if (os.platform() === 'win32') {
        this.killProcessesOnPort(port);
        await new Promise((r) => setTimeout(r, 2000));
      }
      const waitDeadline = Date.now() + 15000;
      while (!portAvailable && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 1000));
        portAvailable = await this.isPortAvailable(port);
      }
      if (!portAvailable) {
        throw new Error(`Port ${port} is already in use. Close any other instance of this app or the process using the port, then try again.`);
      }
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
    
    serviceProcess.stdout.pipe(logStream);
    serviceProcess.stderr.pipe(logStream);
    
    serviceProcess.on('error', (err) => {
      console.error(`${serviceName} error:`, err);
    });
    
    serviceProcess.on('close', (code) => {
      console.log(`${serviceName} exited with code ${code}`);
    });
    
    onProgress?.(`${serviceName} starting, waiting for port ${port}...`, 50);
    
    // Wait for service to be ready
    const ready = await this.waitForPort(port, 60000);
    if (!ready) {
      serviceProcess.kill();
      throw new Error(`${serviceName} failed to start on port ${port}`);
    }
    
    onProgress?.(`${serviceName} started successfully on port ${port}`, 100);
    
    return serviceProcess;
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
    const backendPort = this.config.backendPort;
    const frontendPort = this.config.frontendPort;
    this.killProcessesOnPort(backendPort);
    this.killProcessesOnPort(frontendPort);
    await new Promise((r) => setTimeout(r, PORT_KILL_WAIT_MS));
    this.killProcessesOnPort(backendPort);
    this.killProcessesOnPort(frontendPort);
  }

  /**
   * Fast exit: kill backend and frontend immediately, kill by port, short wait. No port-release loop.
   * Use this when the user clicks Exit so the app closes in ~1–2 seconds instead of 10–30.
   */
  async stopAllServicesForExit(): Promise<void> {
    const backendPort = this.config.backendPort;
    const frontendPort = this.config.frontendPort;
    console.log('[V2] Stopping services (fast exit)...');
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
   * On Windows, also kills by port so 5173 (Vite) and backend port are always freed.
   */
  async stopAllServicesAsync(): Promise<void> {
    const backendPort = this.config.backendPort;
    const frontendPort = this.config.frontendPort;

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
   * V2: Start backend process only (no install, no build). Use with startup update check.
   */
  async startBackendOnly(onProgress?: ProgressCallback): Promise<void> {
    const backendPath = this.pathResolver.getBackendPath();
    onProgress?.('Starting backend...', 0);
    this.backendProcess = await this.startService(
      backendPath,
      this.config.backendStartCommand,
      this.config.backendPort,
      'backend',
      (msg, percent) => onProgress?.(msg, percent),
    );
    onProgress?.('Backend running', 100);
  }

  /**
   * V2: Start frontend process only (creates .env.production, no install, no build). Use with startup update check.
   */
  async startFrontendOnly(onProgress?: ProgressCallback): Promise<void> {
    const frontendPath = this.pathResolver.getFrontendPath();
    this.createFrontendEnvFile(frontendPath);
    onProgress?.('Starting frontend...', 0);
    this.frontendProcess = await this.startService(
      frontendPath,
      this.config.frontendStartCommand,
      this.config.frontendPort,
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

    this.createFrontendEnvFile(frontendPath);

    onProgress?.('Starting backend...', 20);
    this.backendProcess = await this.startService(
      backendPath,
      this.config.backendStartCommand,
      this.config.backendPort,
      'backend',
      (msg, percent) => onProgress?.(msg, 20 + percent * 0.3),
    );
    onProgress?.('Starting frontend...', 50);
    this.frontendProcess = await this.startService(
      frontendPath,
      this.config.frontendStartCommand,
      this.config.frontendPort,
      'frontend',
      (msg, percent) => onProgress?.(msg, 50 + percent * 0.5),
    );
    onProgress?.('All services running', 100);
  }
  
  /**
   * Get service status
   */
  getBackendStatus(): ServiceStatus {
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
