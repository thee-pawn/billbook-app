import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathResolver } from './pathResolver';
import { AppConfig } from './config';

/**
 * V2: Update Manager
 * Fetches latest code and runs npm install in parallel after app start.
 * Notifies user to restart when updates are applied.
 */

export interface UpdateResult {
  updatesApplied: boolean;
  backendChanged: boolean;
  frontendChanged: boolean;
  error?: string;
}

export class UpdateManager {
  private pathResolver: PathResolver;
  private config: AppConfig;

  constructor(pathResolver: PathResolver, config: AppConfig) {
    this.pathResolver = pathResolver;
    this.config = config;
  }

  /**
   * Run git pull in a repo; returns true if something changed.
   * On Windows uses a shell (cmd.exe) so PATH (including portable Git) is respected in packaged apps.
   */
  private async gitPull(repoPath: string): Promise<boolean> {
    if (!fs.existsSync(path.join(repoPath, '.git'))) return false;
    const env = this.pathResolver.getEnvWithPortablePaths();
    const opts: import('child_process').ExecSyncOptions = {
      cwd: repoPath,
      env,
      ...(os.platform() === 'win32' && {
        shell: process.env.COMSPEC || 'cmd.exe',
        windowsHide: true,
      }),
    };
    try {
      const before = execSync('git rev-parse HEAD', { ...opts, encoding: 'utf-8' }).trim();
      execSync('git fetch origin', { ...opts, stdio: 'pipe' });
      execSync(`git reset --hard origin/${this.config.initialBranch}`, { ...opts, stdio: 'pipe' });
      const after = execSync('git rev-parse HEAD', { ...opts, encoding: 'utf-8' }).trim();
      return before !== after;
    } catch (e) {
      console.warn('UpdateManager: gitPull failed for', repoPath, e);
      throw new Error(`git pull failed for ${repoPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Run npm install in a project; returns promise that resolves when done.
   * Uses shell: true and portable PATH so npm/git work in packaged Windows apps.
   */
  private npmInstall(projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
        resolve();
        return;
      }
      const npm = spawn('npm', ['install'], {
        cwd: projectPath,
        stdio: 'ignore',
        shell: true,
        env: { ...this.pathResolver.getEnvWithPortablePaths(), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
        ...(os.platform() === 'win32' && { windowsHide: true }),
      });
      npm.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm install exited ${code}`))));
      npm.on('error', reject);
    });
  }

  /**
   * Pull latest code for a repo. Returns true if something changed.
   * Public for startup flow: check for updates then optionally install.
   */
  async pullRepo(repoPath: string): Promise<boolean> {
    return this.gitPull(repoPath);
  }

  /**
   * Run npm install in a project. Public for startup flow.
   */
  async installRepo(projectPath: string): Promise<void> {
    return this.npmInstall(projectPath);
  }

  /**
   * Run npm run build in backend if config has backendBuildCommand. Public for startup flow.
   */
  async buildBackendIfConfigured(): Promise<void> {
    return this.buildBackend();
  }

  /**
   * Run npm run build in backend if config has backendBuildCommand
   */
  private async buildBackend(): Promise<void> {
    const backendPath = this.pathResolver.getBackendPath();
    if (!this.config.backendBuildCommand || !fs.existsSync(path.join(backendPath, 'package.json'))) return;
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = this.config.backendBuildCommand!.split(' ');
      const p = spawn(cmd, args, {
        cwd: backendPath,
        stdio: 'ignore',
        shell: true,
        env: this.pathResolver.getEnvWithPortablePaths(),
        ...(os.platform() === 'win32' && { windowsHide: true }),
      });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Backend build exited ${code}`))));
      p.on('error', reject);
    });
  }

  /**
   * Check for updates (git pull + npm install) in both repos.
   * Runs in background; does not start services. Returns whether updates were applied.
   */
  async checkAndApplyUpdates(): Promise<UpdateResult> {
    const backendPath = this.pathResolver.getBackendPath();
    const frontendPath = this.pathResolver.getFrontendPath();
    console.log('[V2] UpdateManager: checkAndApplyUpdates started', { backendPath, frontendPath });

    let backendChanged = false;
    let frontendChanged = false;

    try {
      backendChanged = await this.gitPull(backendPath);
      frontendChanged = await this.gitPull(frontendPath);
    } catch (e) {
      console.warn('UpdateManager: git pull failed', e);
      return { updatesApplied: false, backendChanged: false, frontendChanged: false, error: String(e) };
    }

    if (!backendChanged && !frontendChanged) {
      console.log('[V2] UpdateManager: no changes (already up to date)');
      return { updatesApplied: false, backendChanged: false, frontendChanged: false };
    }

    try {
      await Promise.all([this.npmInstall(backendPath), this.npmInstall(frontendPath)]);
      await this.buildBackend();
    } catch (e) {
      console.warn('UpdateManager: npm install or build failed', e);
      return {
        updatesApplied: true,
        backendChanged,
        frontendChanged,
        error: String(e),
      };
    }

    return {
      updatesApplied: true,
      backendChanged,
      frontendChanged,
    };
  }
}
