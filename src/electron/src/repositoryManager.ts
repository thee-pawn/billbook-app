import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PathResolver } from './pathResolver';
import { AppConfig, injectTokenIntoUrl } from './config';

/**
 * Repository Manager
 * Handles cloning and updating Git repositories
 */

export interface RepositoryInfo {
  name: string;
  url: string;
  path: string;
  branch: string;
  exists: boolean;
}

export interface ProgressCallback {
  (message: string, percent: number): void;
}

export class RepositoryManager {
  private pathResolver: PathResolver;
  private config: AppConfig;
  
  constructor(pathResolver: PathResolver, config: AppConfig) {
    this.pathResolver = pathResolver;
    this.config = config;
  }
  
  /**
   * Validate a Git repository URL
   */
  validateRepoUrl(url: string): boolean {
    // Basic validation for GitHub URLs
    const patterns = [
      /^https:\/\/github\.com\/[\w-]+\/[\w-]+\.git$/,
      /^git@github\.com:[\w-]+\/[\w-]+\.git$/,
      /^https:\/\/[^@]+@github\.com\/[\w-]+\/[\w-]+\.git$/, // With token
    ];
    
    return patterns.some(pattern => pattern.test(url));
  }
  
  /**
   * Check if a directory is a valid Git repository
   */
  isGitRepository(dirPath: string): boolean {
    const gitDir = path.join(dirPath, '.git');
    return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
  }
  
  /**
   * Get repository information
   */
  getRepositoryInfo(name: string, url: string, branch: string): RepositoryInfo {
    const repoPath = path.join(this.pathResolver.getReposPath(), name);
    
    return {
      name,
      url,
      path: repoPath,
      branch,
      exists: this.isGitRepository(repoPath),
    };
  }
  
  /**
   * Clone a repository
   */
  async cloneRepository(
    url: string,
    destPath: string,
    branch: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    onProgress?.(`Cloning repository from ${url}...`, 0);
    
    // Inject token if available
    const repoUrl = injectTokenIntoUrl(url, this.config.githubToken);
    
    // Ensure parent directory exists
    const parentDir = path.dirname(destPath);
    this.pathResolver.ensureDirectory(parentDir);
    
    return new Promise((resolve, reject) => {
      const args = ['clone', '--branch', branch, '--progress', repoUrl, destPath];
      const gitProcess = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      
      let output = '';
      
      gitProcess.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // Parse progress from Git output
        const progressMatch = text.match(/Receiving objects:\s+(\d+)%/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          onProgress?.(`Cloning: ${percent}%`, percent);
        }
      });
      
      gitProcess.on('close', (code) => {
        if (code === 0) {
          onProgress?.('Repository cloned successfully', 100);
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}: ${output}`));
        }
      });
      
      gitProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn git: ${err.message}`));
      });
    });
  }
  
  /**
   * Pull latest changes from repository
   */
  async pullRepository(
    repoPath: string,
    branch: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    onProgress?.('Pulling latest changes...', 0);
    
    if (!this.isGitRepository(repoPath)) {
      throw new Error(`${repoPath} is not a valid Git repository`);
    }
    
    try {
      // Fetch latest changes
      onProgress?.('Fetching from remote...', 30);
      const env = this.pathResolver.getEnvWithPortablePaths();
      execSync('git fetch origin', {
        cwd: repoPath,
        stdio: 'pipe',
        env,
      });
      
      onProgress?.('Updating to latest commit...', 60);
      execSync(`git reset --hard origin/${branch}`, {
        cwd: repoPath,
        stdio: 'pipe',
        env,
      });
      
      onProgress?.('Cleaning workspace...', 80);
      execSync('git clean -fd', {
        cwd: repoPath,
        stdio: 'pipe',
        env,
      });
      
      onProgress?.('Repository updated successfully', 100);
    } catch (error: any) {
      throw new Error(`Failed to pull repository: ${error.message}`);
    }
  }
  
  /**
   * Checkout a specific branch
   */
  async checkoutBranch(repoPath: string, branch: string): Promise<void> {
    if (!this.isGitRepository(repoPath)) {
      throw new Error(`${repoPath} is not a valid Git repository`);
    }
    
    try {
      execSync(`git checkout ${branch}`, {
        cwd: repoPath,
        stdio: 'pipe',
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
    } catch (error: any) {
      throw new Error(`Failed to checkout branch ${branch}: ${error.message}`);
    }
  }
  
  /**
   * Get the current branch name
   */
  getCurrentBranch(repoPath: string): string | null {
    if (!this.isGitRepository(repoPath)) {
      return null;
    }
    
    try {
      const result = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      return result.trim();
    } catch {
      return null;
    }
  }
  
  /**
   * Check if repository has uncommitted changes
   */
  hasUncommittedChanges(repoPath: string): boolean {
    if (!this.isGitRepository(repoPath)) {
      return false;
    }
    
    try {
      const result = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
        env: this.pathResolver.getEnvWithPortablePaths(),
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }
  
  /**
   * Ensure backend repository is ready
   */
  async ensureBackendRepository(onProgress?: ProgressCallback): Promise<string> {
    const backendPath = this.pathResolver.getBackendPath();
    const repoInfo = this.getRepositoryInfo('backend', this.config.backendRepoUrl, this.config.initialBranch);
    
    if (repoInfo.exists) {
      onProgress?.('Backend repository exists, updating...', 0);
      await this.pullRepository(backendPath, this.config.initialBranch, (msg, percent) => {
        onProgress?.(msg, percent);
      });
    } else {
      onProgress?.('Cloning backend repository...', 0);
      await this.cloneRepository(
        this.config.backendRepoUrl,
        backendPath,
        this.config.initialBranch,
        (msg, percent) => {
          onProgress?.(msg, percent);
        }
      );
    }
    
    return backendPath;
  }
  
  /**
   * Ensure frontend repository is ready
   */
  async ensureFrontendRepository(onProgress?: ProgressCallback): Promise<string> {
    const frontendPath = this.pathResolver.getFrontendPath();
    const repoInfo = this.getRepositoryInfo('frontend', this.config.frontendRepoUrl, this.config.initialBranch);
    
    if (repoInfo.exists) {
      onProgress?.('Frontend repository exists, updating...', 0);
      await this.pullRepository(frontendPath, this.config.initialBranch, (msg, percent) => {
        onProgress?.(msg, percent);
      });
    } else {
      onProgress?.('Cloning frontend repository...', 0);
      await this.cloneRepository(
        this.config.frontendRepoUrl,
        frontendPath,
        this.config.initialBranch,
        (msg, percent) => {
          onProgress?.(msg, percent);
        }
      );
    }
    
    return frontendPath;
  }
  
  /**
   * Ensure both repositories are ready
   */
  async ensureAllRepositories(onProgress?: ProgressCallback): Promise<{backend: string; frontend: string}> {
    onProgress?.('Setting up repositories...', 0);
    
    // Ensure backend
    onProgress?.('Preparing backend repository...', 10);
    const backendPath = await this.ensureBackendRepository((msg, percent) => {
      onProgress?.(msg, 10 + percent * 0.4);
    });
    
    // Ensure frontend
    onProgress?.('Preparing frontend repository...', 50);
    const frontendPath = await this.ensureFrontendRepository((msg, percent) => {
      onProgress?.(msg, 50 + percent * 0.4);
    });
    
    onProgress?.('All repositories ready', 100);
    
    return { backend: backendPath, frontend: frontendPath };
  }
}
