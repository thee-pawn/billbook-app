import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

/**
 * Path resolver utility for managing application directories
 */

export class PathResolver {
  private userDataPath: string;
  
  constructor(userDataPath?: string) {
    this.userDataPath = userDataPath || app.getPath('userData');
  }
  
  /**
   * Get the base directory for all application data
   */
  getUserDataPath(): string {
    return this.userDataPath;
  }
  
  /**
   * Get the directory where repositories are stored
   */
  getReposPath(): string {
    return path.join(this.userDataPath, 'repos');
  }
  
  /**
   * Get the directory where dependencies are installed
   */
  getDependenciesPath(): string {
    return path.join(this.userDataPath, 'dependencies');
  }

  /**
   * V2: Directory for portable Node.js (no admin required)
   */
  getPortableNodeDir(): string {
    return path.join(this.userDataPath, 'portable', 'node');
  }

  /**
   * V2: Directory for portable Git (no admin required)
   */
  getPortableGitDir(): string {
    return path.join(this.userDataPath, 'portable', 'git');
  }

  /**
   * V2: Path to the directory containing node/npm binaries (to prepend to PATH)
   * Windows zip: node-vX.Y.Z-win-x64/ has node.exe and npm.cmd in root
   */
  getPortableNodeBinPath(): string {
    return this.getPortableNodeDir();
  }

  /**
   * V2: Path to the directory containing git binary (to prepend to PATH)
   * Portable Git on Windows: .../cmd or .../bin
   */
  getPortableGitBinPath(): string {
    const base = this.getPortableGitDir();
    if (process.platform === 'win32') {
      return path.join(base, 'cmd');
    }
    return path.join(base, 'bin');
  }

  /**
   * V2: Whether portable Node is installed (no admin required)
   */
  isPortableNodeInstalled(): boolean {
    const dir = this.getPortableNodeDir();
    if (process.platform === 'win32') {
      return fs.existsSync(path.join(dir, 'node.exe'));
    }
    return fs.existsSync(path.join(dir, 'bin', 'node'));
  }

  /**
   * V2: Whether portable Git is installed (no admin required)
   */
  isPortableGitInstalled(): boolean {
    const binPath = this.getPortableGitBinPath();
    const exe = process.platform === 'win32' ? 'git.exe' : 'git';
    return fs.existsSync(path.join(binPath, exe));
  }

  /**
   * V2: Environment object for spawning child processes (npm, git, node) with portable paths first.
   */
  getEnvWithPortablePaths(): NodeJS.ProcessEnv {
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const current = process.env.PATH || '';
    const prepend: string[] = [];
    if (this.isPortableNodeInstalled()) {
      prepend.push(this.getPortableNodeBinPath());
    }
    if (this.isPortableGitInstalled()) {
      prepend.push(this.getPortableGitBinPath());
    }
    const PATH = prepend.length ? [...prepend, current].join(pathSep) : current;
    return { ...process.env, PATH };
  }

  /**
   * V2: Flag file indicating first-time setup is complete (repos cloned, deps installed, built)
   */
  getV2ReadyFlagPath(): string {
    return path.join(this.userDataPath, '.v2-ready');
  }

  /**
   * V2: Check if app has completed first-time setup
   */
  isV2Ready(): boolean {
    return fs.existsSync(this.getV2ReadyFlagPath());
  }

  /**
   * V2: Mark first-time setup as complete
   */
  setV2Ready(): void {
    fs.writeFileSync(this.getV2ReadyFlagPath(), new Date().toISOString(), 'utf-8');
  }
  
  /**
   * Get the backend repository path
   */
  getBackendPath(): string {
    return path.join(this.getReposPath(), 'backend');
  }
  
  /**
   * Get the frontend repository path
   */
  getFrontendPath(): string {
    return path.join(this.getReposPath(), 'frontend');
  }
  
  /**
   * Get the logs directory path
   */
  getLogsPath(): string {
    return path.join(this.userDataPath, 'logs');
  }
  
  /**
   * Ensure a directory exists, create it if it doesn't
   */
  ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  /**
   * Initialize all necessary directories
   */
  initializeDirectories(): void {
    this.ensureDirectory(this.getUserDataPath());
    this.ensureDirectory(this.getReposPath());
    this.ensureDirectory(this.getDependenciesPath());
    this.ensureDirectory(this.getLogsPath());
    this.ensureDirectory(path.join(this.userDataPath, 'portable'));
  }
  
  /**
   * Check if a path exists
   */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
  
  /**
   * Get the path to a log file
   */
  getLogFilePath(name: string): string {
    return path.join(this.getLogsPath(), `${name}.log`);
  }
}
