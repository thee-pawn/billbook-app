import { execSync, exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { PathResolver } from './pathResolver';

/**
 * Dependency Manager
 * Handles automatic detection and installation of Git, Node.js, and npm
 */

export interface DependencyStatus {
  git: {
    installed: boolean;
    version?: string;
    path?: string;
  };
  node: {
    installed: boolean;
    version?: string;
    path?: string;
  };
  npm: {
    installed: boolean;
    version?: string;
    path?: string;
  };
}

export interface ProgressCallback {
  (message: string, percent: number): void;
}

export class DependencyManager {
  private pathResolver: PathResolver;
  private platform: string;
  
  constructor(pathResolver: PathResolver) {
    this.pathResolver = pathResolver;
    this.platform = os.platform();
  }
  
  /**
   * Check if a command exists in the system
   * Checks both PATH and common installation locations
   */
  private commandExists(command: string): boolean {
    try {
      // First try using which/where with full PATH
      const which = this.platform === 'win32' ? 'where' : 'which';
      const fullPath = this.getFullPath();
      execSync(`${which} ${command}`, { 
        stdio: 'ignore',
        env: { ...process.env, PATH: fullPath }
      });
      return true;
    } catch {
      // Fall back to checking common installation paths directly
      return this.checkCommonPaths(command);
    }
  }
  
  /**
   * Get full PATH including portable (no-admin) paths first, then common installation directories
   */
  private getFullPath(): string {
    const currentPath = process.env.PATH || '';
    const pathSeparator = this.platform === 'win32' ? ';' : ':';
    const portable: string[] = [];
    if (this.pathResolver.isPortableNodeInstalled()) {
      portable.push(this.pathResolver.getPortableNodeBinPath());
    }
    if (this.pathResolver.isPortableGitInstalled()) {
      portable.push(this.pathResolver.getPortableGitBinPath());
    }
    const commonPaths = this.platform === 'darwin'
      ? ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
      : this.platform === 'win32'
      ? ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\nodejs', 'C:\\Windows\\System32']
      : ['/usr/local/bin', '/usr/bin', '/bin'];
    const allPaths = [...portable, ...commonPaths, ...currentPath.split(pathSeparator).filter(Boolean)];
    const uniquePaths = [...new Set(allPaths)];
    return uniquePaths.join(pathSeparator);
  }
  
  /**
   * Check if command exists in common installation paths (including portable)
   */
  private checkCommonPaths(command: string): boolean {
    const ext = this.platform === 'win32' ? '.exe' : '';
    if (this.pathResolver.isPortableNodeInstalled()) {
      const nodeBin = this.pathResolver.getPortableNodeBinPath();
      if (command === 'node' && fs.existsSync(path.join(nodeBin, 'node' + ext))) return true;
      if (command === 'npm' && (fs.existsSync(path.join(nodeBin, 'npm' + ext)) || fs.existsSync(path.join(nodeBin, 'npm.cmd')))) return true;
    }
    if (this.pathResolver.isPortableGitInstalled()) {
      const gitBin = this.pathResolver.getPortableGitBinPath();
      if (command === 'git' && fs.existsSync(path.join(gitBin, 'git' + ext))) return true;
    }
    if (this.platform === 'win32') {
      const paths = [
        `C:\\Program Files\\Git\\cmd\\${command}.exe`,
        `C:\\Program Files\\nodejs\\${command}.exe`,
      ];
      return paths.some(p => fs.existsSync(p));
    }
    const paths = [
      `/usr/local/bin/${command}`,
      `/opt/homebrew/bin/${command}`,
      `/usr/bin/${command}`,
      `/bin/${command}`,
    ];
    return paths.some(p => fs.existsSync(p));
  }
  
  /**
   * Get version of a command
   */
  private getVersion(command: string, args: string = '--version'): string | undefined {
    try {
      const fullPath = this.getFullPath();
      const result = execSync(`${command} ${args}`, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, PATH: fullPath }
      });
      return result.trim().split('\n')[0];
    } catch {
      return undefined;
    }
  }
  
  /**
   * Get the path to a command
   */
  private getCommandPath(command: string): string | undefined {
    try {
      const which = this.platform === 'win32' ? 'where' : 'which';
      const fullPath = this.getFullPath();
      const result = execSync(`${which} ${command}`, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, PATH: fullPath }
      });
      return result.trim().split('\n')[0];
    } catch {
      return undefined;
    }
  }
  
  /**
   * Check the status of all dependencies
   */
  async checkDependencies(): Promise<DependencyStatus> {
    const status: DependencyStatus = {
      git: {
        installed: this.commandExists('git'),
      },
      node: {
        installed: this.commandExists('node'),
      },
      npm: {
        installed: this.commandExists('npm'),
      },
    };
    
    if (status.git.installed) {
      status.git.version = this.getVersion('git');
      status.git.path = this.getCommandPath('git');
    }
    
    if (status.node.installed) {
      status.node.version = this.getVersion('node');
      status.node.path = this.getCommandPath('node');
    }
    
    if (status.npm.installed) {
      status.npm.version = this.getVersion('npm');
      status.npm.path = this.getCommandPath('npm');
    }
    
    return status;
  }
  
  /**
   * Download a file from a URL
   */
  private downloadFile(url: string, destPath: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          file.close();
          fs.unlinkSync(destPath);
          if (response.headers.location) {
            this.downloadFile(response.headers.location, destPath, onProgress)
              .then(resolve)
              .catch(reject);
          }
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            const percent = (downloadedSize / totalSize) * 100;
            onProgress(`Downloading: ${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB`, percent);
          }
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    });
  }
  
  /**
   * Install Git based on platform
   */
  async installGit(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing Git...', 0);
    
    const depsPath = this.pathResolver.getDependenciesPath();
    this.pathResolver.ensureDirectory(depsPath);
    
    switch (this.platform) {
      case 'win32':
        await this.installGitWindows(depsPath, onProgress);
        break;
      case 'darwin':
        await this.installGitMacOS(depsPath, onProgress);
        break;
      case 'linux':
        await this.installGitLinux(depsPath, onProgress);
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
    
    onProgress?.('Git installation complete', 100);
  }
  
  /**
   * V2: Install portable Node.js on Windows (no admin). Extracts zip to userData/portable/node.
   */
  private async installPortableNodeWindows(onProgress?: ProgressCallback): Promise<void> {
    const depsPath = this.pathResolver.getDependenciesPath();
    const nodeDir = this.pathResolver.getPortableNodeDir();
    const nodeZipUrl = 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-win-x64.zip';
    const zipPath = path.join(depsPath, 'node-portable.zip');
    const extractDir = path.join(depsPath, 'node-zip-extract');

    this.pathResolver.ensureDirectory(depsPath);
    onProgress?.('Downloading portable Node.js (no admin required)...', 10);
    await this.downloadFile(nodeZipUrl, zipPath, (msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.5);
    });

    onProgress?.('Extracting Node.js...', 60);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const zipLiteral = zipPath.replace(/'/g, "''");
    const destLiteral = extractDir.replace(/'/g, "''");
    execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipLiteral}' -DestinationPath '${destLiteral}' -Force"`, {
      stdio: 'pipe',
      windowsHide: true,
    });
    const entries = fs.readdirSync(extractDir);
    const innerFolder = entries.find((e) => fs.statSync(path.join(extractDir, e)).isDirectory());
    if (!innerFolder) throw new Error('Node zip had no inner folder');
    const innerPath = path.join(extractDir, innerFolder);
    if (fs.existsSync(nodeDir)) fs.rmSync(nodeDir, { recursive: true });
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.cpSync(innerPath, nodeDir, { recursive: true });
    fs.rmSync(extractDir, { recursive: true });
    try { fs.unlinkSync(zipPath); } catch {}
    onProgress?.('Portable Node.js installed', 100);
  }

  /**
   * V2: Install portable MinGit on Windows (no admin). Extracts zip to userData/portable/git.
   */
  private async installPortableGitWindows(onProgress?: ProgressCallback): Promise<void> {
    const depsPath = this.pathResolver.getDependenciesPath();
    const gitDir = this.pathResolver.getPortableGitDir();
    const gitZipUrl = 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/MinGit-2.43.0-64-bit.zip';
    const zipPath = path.join(depsPath, 'mingit-portable.zip');
    const extractDir = path.join(depsPath, 'git-zip-extract');

    this.pathResolver.ensureDirectory(depsPath);
    onProgress?.('Downloading portable Git (no admin required)...', 10);
    await this.downloadFile(gitZipUrl, zipPath, (msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.5);
    });

    onProgress?.('Extracting Git...', 60);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const zipLiteral = zipPath.replace(/'/g, "''");
    const destLiteral = extractDir.replace(/'/g, "''");
    execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipLiteral}' -DestinationPath '${destLiteral}' -Force"`, {
      stdio: 'pipe',
      windowsHide: true,
    });
    const entries = fs.readdirSync(extractDir);
    const innerFolder = entries.find((e) => fs.statSync(path.join(extractDir, e)).isDirectory());
    if (!innerFolder) throw new Error('MinGit zip had no inner folder');
    const innerPath = path.join(extractDir, innerFolder);
    if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });
    fs.renameSync(innerPath, gitDir);
    fs.rmSync(extractDir, { recursive: true });
    try { fs.unlinkSync(zipPath); } catch {}
    onProgress?.('Portable Git installed', 100);
  }

  /**
   * V2: Ensure Microsoft Visual C++ Redistributable is installed on Windows.
   * Required for native Node modules (e.g. Tailwind @tailwindcss/oxide). May prompt UAC once.
   */
  private async ensureVCRedistributableWindows(onProgress?: ProgressCallback): Promise<void> {
    const depsPath = this.pathResolver.getDependenciesPath();
    this.pathResolver.ensureDirectory(depsPath);
    const exePath = path.join(depsPath, 'vc_redist.x64.exe');
    const vcRedistUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

    if (!fs.existsSync(exePath)) {
      onProgress?.('Downloading Visual C++ Redistributable...', 40);
      await this.downloadFile(vcRedistUrl, exePath, (msg, percent) => {
        onProgress?.(msg, 40 + percent * 0.2);
      });
    }

    onProgress?.('Installing Visual C++ Runtime (you may see a security prompt)...', 60);
    return new Promise((resolve, reject) => {
      const child = spawn(exePath, ['/install', '/passive', '/norestart'], {
        stdio: 'ignore',
        windowsHide: false,
      });
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        reject(new Error('VC++ install timed out'));
      }, 120000);
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0 || code === 3010) {
          onProgress?.('Visual C++ Runtime ready', 65);
          resolve();
        } else if (code != null) {
          reject(new Error(`VC++ installer exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Install Git on Windows (legacy MSI; prefer portable via ensureAllDependencies)
   */
  private async installGitWindows(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    const gitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe';
    const installerPath = path.join(depsPath, 'git-installer.exe');
    
    onProgress?.('Downloading Git for Windows...', 10);
    await this.downloadFile(gitUrl, installerPath, (msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.5);
    });
    
    onProgress?.('Running Git installer...', 60);
    
    execSync(`"${installerPath}" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS`, {
      stdio: 'ignore',
    });
    
    onProgress?.('Git installed successfully', 100);
  }
  
  /**
   * Install Git on macOS
   */
  private async installGitMacOS(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing Git via Xcode Command Line Tools...', 20);
    
    try {
      // On macOS, Git comes with Xcode Command Line Tools
      // This is much simpler than Homebrew and already available on most Macs
      onProgress?.('Triggering Xcode Command Line Tools installation...', 40);
      
      // This command prompts the user to install Xcode Command Line Tools
      // It's non-blocking and will show a system dialog
      execSync('xcode-select --install', { 
        stdio: 'pipe' // Suppress output as it may fail if already installed
      });
      
      onProgress?.('Please complete the Xcode Command Line Tools installation dialog', 60);
      
      // Wait for git to become available
      let attempts = 0;
      const maxAttempts = 60; // Wait up to 5 minutes
      
      while (attempts < maxAttempts) {
        onProgress?.(`Waiting for Git installation... (${attempts + 1}/${maxAttempts})`, 80 + (attempts / maxAttempts) * 20);
        
        if (this.commandExists('git')) {
          onProgress?.('Git installed successfully', 100);
          return;
        }
        
        // Check common Git paths
        if (fs.existsSync('/usr/bin/git') || fs.existsSync('/usr/local/bin/git')) {
          process.env.PATH = `/usr/bin:/usr/local/bin:${process.env.PATH}`;
          onProgress?.('Git installed successfully', 100);
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
        attempts++;
      }
      
      throw new Error('Git installation timed out. Please install Xcode Command Line Tools manually and restart the application.');
      
    } catch (error: any) {
      // If xcode-select fails, Git might already be installed or we need Homebrew
      if (this.commandExists('git')) {
        onProgress?.('Git already installed', 100);
        return;
      }
      
      // Fallback to Homebrew if available
      if (this.commandExists('brew')) {
        onProgress?.('Installing Git via Homebrew...', 60);
        execSync('brew install git', { stdio: 'inherit' });
        onProgress?.('Git installed successfully', 100);
      } else {
        throw new Error('Git installation failed. Please install Xcode Command Line Tools manually by running: xcode-select --install');
      }
    }
  }
  
  /**
   * Install Git on Linux
   */
  private async installGitLinux(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing Git via package manager...', 20);
    
    // Try to detect the package manager
    if (this.commandExists('apt-get')) {
      execSync('sudo apt-get update && sudo apt-get install -y git', { stdio: 'inherit' });
    } else if (this.commandExists('yum')) {
      execSync('sudo yum install -y git', { stdio: 'inherit' });
    } else if (this.commandExists('dnf')) {
      execSync('sudo dnf install -y git', { stdio: 'inherit' });
    } else if (this.commandExists('pacman')) {
      execSync('sudo pacman -S --noconfirm git', { stdio: 'inherit' });
    } else {
      throw new Error('Could not detect package manager. Please install Git manually.');
    }
    
    onProgress?.('Git installed successfully', 100);
  }
  
  /**
   * Install Node.js based on platform
   */
  async installNodeJS(onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing Node.js...', 0);
    
    const depsPath = this.pathResolver.getDependenciesPath();
    this.pathResolver.ensureDirectory(depsPath);
    
    switch (this.platform) {
      case 'win32':
        await this.installNodeWindows(depsPath, onProgress);
        break;
      case 'darwin':
        await this.installNodeMacOS(depsPath, onProgress);
        break;
      case 'linux':
        await this.installNodeLinux(depsPath, onProgress);
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
    
    onProgress?.('Node.js installation complete', 100);
  }
  
  /**
   * Install Node.js on Windows
   */
  private async installNodeWindows(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    const nodeUrl = 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi';
    const installerPath = path.join(depsPath, 'node-installer.msi');
    
    onProgress?.('Downloading Node.js for Windows...', 10);
    await this.downloadFile(nodeUrl, installerPath, (msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.5);
    });
    
    onProgress?.('Running Node.js installer...', 60);
    
    // Run installer asynchronously with timeout
    return new Promise((resolve, reject) => {
      const installCommand = `msiexec /i "${installerPath}" /qn /norestart /log "${path.join(depsPath, 'node-install.log')}"`;
      
      onProgress?.('Installing Node.js (this may take 1-2 minutes)...', 70);
      
      const installProcess = exec(installCommand, {
        timeout: 180000, // 3 minute timeout
        windowsHide: true,
      });
      
      let progressInterval = setInterval(() => {
        // Check if Node.js is now available (installation completed)
        if (this.commandExists('node')) {
          clearInterval(progressInterval);
          if (installProcess && !installProcess.killed) {
            installProcess.kill();
          }
          onProgress?.('Node.js installed successfully', 100);
          resolve();
        }
      }, 2000);
      
      installProcess.on('exit', (code) => {
        clearInterval(progressInterval);
        
        if (code === 0 || this.commandExists('node')) {
          onProgress?.('Node.js installed successfully', 100);
          resolve();
        } else if (code === 1602) {
          // User cancelled installation
          reject(new Error('Node.js installation was cancelled by user'));
        } else if (code === 1603) {
          // Fatal error during installation
          reject(new Error('Node.js installation failed with a fatal error. The application may need administrator privileges.\n\nPlease either:\n1. Close this app and run it as Administrator, OR\n2. Install Node.js manually from https://nodejs.org/'));
        } else {
          reject(new Error(`Node.js installation failed with exit code ${code}.\n\nPlease install Node.js manually from https://nodejs.org/`));
        }
      });
      
      installProcess.on('error', (error) => {
        clearInterval(progressInterval);
        reject(new Error(`Failed to run Node.js installer: ${error.message}\n\nPlease install Node.js manually from https://nodejs.org/`));
      });
      
      // Timeout handler
      setTimeout(() => {
        if (!this.commandExists('node')) {
          clearInterval(progressInterval);
          if (installProcess && !installProcess.killed) {
            installProcess.kill();
          }
          reject(new Error('Node.js installation timed out after 3 minutes.\n\nThis usually means the installer needs administrator privileges.\n\nPlease either:\n1. Close this app and run it as Administrator, OR\n2. Install Node.js manually from https://nodejs.org/'));
        }
      }, 180000);
    });
  }
  
  /**
   * Install Node.js on macOS
   */
  private async installNodeMacOS(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Downloading Node.js installer...', 10);
    
    const nodeVersion = 'v20.11.0'; // LTS version
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}.pkg`;
    const installerPath = path.join(depsPath, 'node-installer.pkg');
    
    try {
      // Download Node.js installer
      await this.downloadFile(nodeUrl, installerPath, (msg, percent) => {
        onProgress?.(msg, 10 + percent * 0.5);
      });
      
      onProgress?.('Installing Node.js...', 60);
      
      // Run the installer
      // Note: This requires sudo/admin access and will show a system dialog
      execSync(`open "${installerPath}"`, {
        stdio: 'inherit',
      });
      
      onProgress?.('Please complete the Node.js installation dialog', 70);
      onProgress?.('Waiting for installation to complete...', 80);
      
      // Wait for node to become available
      let attempts = 0;
      const maxAttempts = 60; // Wait up to 5 minutes
      
      while (attempts < maxAttempts) {
        onProgress?.(`Waiting for Node.js installation... (${attempts + 1}/${maxAttempts})`, 80 + (attempts / maxAttempts) * 15);
        
        // Check common Node.js installation paths on macOS
        const nodePaths = [
          '/usr/local/bin/node',
          '/opt/homebrew/bin/node',
          `${process.env.HOME}/.nvm/versions/node/*/bin/node`,
        ];
        
        // First check if node is in PATH
        if (this.commandExists('node')) {
          onProgress?.('Node.js installed successfully', 100);
          return;
        }
        
        // Then check common installation locations
        for (const nodePath of nodePaths) {
          if (fs.existsSync(nodePath)) {
            // Found Node.js, update PATH for this process
            process.env.PATH = `${path.dirname(nodePath)}:${process.env.PATH}`;
            console.log(`✅ Found Node.js at: ${nodePath}`);
            console.log(`📝 Updated PATH: ${process.env.PATH}`);
            onProgress?.('Node.js installed successfully', 100);
            return;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
        attempts++;
      }
      
      throw new Error('Node.js installation timed out. Please complete the installation manually and restart the application.');
      
    } catch (error: any) {
      // Check if Node.js is already installed
      if (this.commandExists('node')) {
        onProgress?.('Node.js already installed', 100);
        return;
      }
      
      // Fallback to Homebrew if available
      if (this.commandExists('brew')) {
        onProgress?.('Installing Node.js via Homebrew...', 60);
        execSync('brew install node', { stdio: 'inherit' });
        onProgress?.('Node.js installed successfully', 100);
      } else {
        throw new Error(`Node.js installation failed: ${error.message}\n\nPlease download and install Node.js manually from https://nodejs.org/`);
      }
    }
  }
  
  /**
   * Install Node.js on Linux
   */
  private async installNodeLinux(depsPath: string, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.('Installing Node.js via package manager...', 20);
    
    // Install Node.js using NodeSource repository
    if (this.commandExists('apt-get')) {
      execSync('curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -', { stdio: 'inherit' });
      execSync('sudo apt-get install -y nodejs', { stdio: 'inherit' });
    } else if (this.commandExists('yum')) {
      execSync('curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -', { stdio: 'inherit' });
      execSync('sudo yum install -y nodejs', { stdio: 'inherit' });
    } else if (this.commandExists('dnf')) {
      execSync('curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -', { stdio: 'inherit' });
      execSync('sudo dnf install -y nodejs', { stdio: 'inherit' });
    } else {
      throw new Error('Could not detect package manager. Please install Node.js manually.');
    }
    
    onProgress?.('Node.js installed successfully', 100);
  }
  
  /**
   * Ensure all dependencies are installed
   */
  async ensureAllDependencies(onProgress?: ProgressCallback): Promise<DependencyStatus> {
    onProgress?.('Checking dependencies...', 0);

    // V2: On Windows, install portable Node and Git first (no admin required)
    if (this.platform === 'win32') {
      if (!this.pathResolver.isPortableNodeInstalled()) {
        console.log('Installing portable Node.js (no admin required)...');
        onProgress?.('Installing portable Node.js...', 5);
        await this.installPortableNodeWindows((msg, percent) => {
          onProgress?.(msg, 5 + percent * 0.15);
        });
      }
      if (!this.pathResolver.isPortableGitInstalled()) {
        console.log('Installing portable Git (no admin required)...');
        onProgress?.('Installing portable Git...', 20);
        await this.installPortableGitWindows((msg, percent) => {
          onProgress?.(msg, 20 + percent * 0.15);
        });
      }
      // Ensure Visual C++ Redistributable (required for Tailwind/native modules). May prompt UAC once.
      try {
        onProgress?.('Checking Visual C++ Runtime (required for frontend build)...', 35);
        await this.ensureVCRedistributableWindows(onProgress);
      } catch (e) {
        console.warn('VC++ Redistributable install failed (non-fatal):', e);
      }
    }

    const status = await this.checkDependencies();
    
    // Check Git
    if (status.git.installed) {
      console.log(`✅ Git found: ${status.git.version} at ${status.git.path}`);
      onProgress?.('Git already installed', 20);
    } else {
      console.log('⚠️  Git not found, attempting installation...');
      onProgress?.('Git not found, installing...', 10);
      
      try {
        await this.installGit((msg, percent) => {
          onProgress?.(msg, 10 + percent * 0.4);
        });
        
        // Re-check Git
        status.git.installed = this.commandExists('git');
        status.git.version = this.getVersion('git');
        status.git.path = this.getCommandPath('git');
        
        if (!status.git.installed) {
          throw new Error('Git installation completed but git command not found');
        }
      } catch (error: any) {
        throw new Error(`Git is required but installation failed: ${error.message}\n\nPlease install Git manually:\nmacOS: Run 'xcode-select --install'\nWindows: Download from https://git-scm.com/download/win\nLinux: Run 'sudo apt install git' or equivalent`);
      }
    }
    
    // Check Node.js
    if (status.node.installed) {
      console.log(`✅ Node.js found: ${status.node.version} at ${status.node.path}`);
      onProgress?.('Node.js already installed', 60);
    } else {
      console.log('⚠️  Node.js not found, attempting installation...');
      onProgress?.('Node.js not found, installing...', 50);
      onProgress?.('Note: You may see a Windows UAC prompt - please approve it', 55);
      
      try {
        await this.installNodeJS((msg, percent) => {
          onProgress?.(msg, 50 + percent * 0.4);
        });
        
        // Wait a bit for PATH to update
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Re-check Node.js and npm
        status.node.installed = this.commandExists('node');
        status.node.version = this.getVersion('node');
        status.node.path = this.getCommandPath('node');
        
        status.npm.installed = this.commandExists('npm');
        status.npm.version = this.getVersion('npm');
        status.npm.path = this.getCommandPath('npm');
        
        if (!status.node.installed) {
          throw new Error('Node.js installation completed but node command not found.\n\nPlease restart the application to refresh environment variables.');
        }
      } catch (error: any) {
        throw new Error(`Node.js is required but installation failed: ${error.message}\n\nPlease install Node.js manually from https://nodejs.org/ and restart the application.`);
      }
    }
    
    onProgress?.('All dependencies ready', 100);
    console.log('✅ All dependencies verified');
    
    return status;
  }
}
