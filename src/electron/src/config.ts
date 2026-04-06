import * as path from 'path';
import * as fs from 'fs';

/**
 * Application Configuration
 * 
 * CUSTOMIZE THESE VALUES FOR YOUR APPLICATION:
 */

export interface AppConfig {
  // Repository URLs
  backendRepoUrl: string;
  frontendRepoUrl: string;
  
  // Commands
  backendBuildCommand?: string;
  backendStartCommand: string;
  frontendBuildCommand: string;
  frontendStartCommand: string;
  
  // Application metadata
  appName: string;
  appId: string;
  
  // Ports
  backendPort: number;
  frontendPort: number;
  
  // Git branch
  initialBranch: string;
  
  // GitHub authentication (optional, for private repos)
  githubToken?: string;
  
  // Custom frontend environment variables (optional)
  // These will be written to .env.production
  frontendEnv?: Record<string, string>;
}

/**
 * Default configuration
 * EDIT THESE VALUES:
 */
const defaultConfig: AppConfig = {
  // TODO: Replace with your actual repository URLs
  backendRepoUrl: "https://github.com/your-org/backend.git",
  frontendRepoUrl: "https://github.com/your-org/frontend.git",
  
  // npm commands to run
  backendStartCommand: "npm run start",
  frontendBuildCommand: "npm run build",
  frontendStartCommand: "npm run start",
  
  // Application metadata
  appName: "BillBook Application",
  appId: "com.billbook.app",
  
  // Service ports
  backendPort: 3001,
  frontendPort: 3000,
  
  // Default branch to checkout
  initialBranch: "main",
};

/**
 * Load configuration from file or environment
 * Priority: config.local.json > environment variables > default config
 */
export function loadConfig(userDataPath: string, appPath?: string): AppConfig {
  let config = { ...defaultConfig };
  
  // Try multiple locations for config.local.json
  const configLocations = [
    // 1. Packaged app root (production) - inside app.asar
    appPath ? path.join(appPath, 'config.local.json') : '',
    // 2. Project root (for development)
    path.join(__dirname, '..', '..', '..', 'config.local.json'),
    // 3. User data directory (user can override after installation)
    path.join(userDataPath, 'config.local.json'),
    // 4. Process resources path (alternative packaged location)
    process.resourcesPath ? path.join(process.resourcesPath, '..', 'config.local.json') : '',
    // 5. One level up from user data
    path.join(userDataPath, '..', 'config.local.json'),
  ].filter(Boolean);
  
  let configLoaded = false;
  for (const localConfigPath of configLocations) {
    if (fs.existsSync(localConfigPath)) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
        config = { ...config, ...localConfig };
        console.log(`Loaded configuration from: ${localConfigPath}`);
        configLoaded = true;
        break;
      } catch (error) {
        console.error(`Failed to parse config at ${localConfigPath}:`, error);
      }
    }
  }
  
  if (!configLoaded) {
    console.warn('\n⚠️  WARNING: No config.local.json found. Using default configuration.');
    console.warn('This means the app will try to clone placeholder repositories!');
    console.warn('\nSearched locations:');
    configLocations.forEach((loc, i) => {
      console.warn(`  ${i + 1}. ${loc} ${fs.existsSync(loc) ? '✓ EXISTS (but failed to parse)' : '✗ NOT FOUND'}`);
    });
    console.warn('\n💡 To fix: Place config.local.json in the app directory or user data directory.');
  } else {
    console.log('✅ Configuration loaded successfully!');
  }
  
  // Override with environment variables if present
  if (process.env.GITHUB_TOKEN) {
    config.githubToken = process.env.GITHUB_TOKEN;
  }
  
  if (process.env.BACKEND_REPO_URL) {
    config.backendRepoUrl = process.env.BACKEND_REPO_URL;
  }
  
  if (process.env.FRONTEND_REPO_URL) {
    config.frontendRepoUrl = process.env.FRONTEND_REPO_URL;
  }
  
  if (process.env.BACKEND_PORT) {
    config.backendPort = parseInt(process.env.BACKEND_PORT, 10);
  }
  
  if (process.env.FRONTEND_PORT) {
    config.frontendPort = parseInt(process.env.FRONTEND_PORT, 10);
  }
  
  return config;
}

/**
 * Inject GitHub token into repository URL if available
 */
export function injectTokenIntoUrl(url: string, token?: string): string {
  if (!token) return url;
  
  // Only inject token for HTTPS URLs
  if (url.startsWith('https://github.com/')) {
    return url.replace('https://github.com/', `https://${token}@github.com/`);
  }
  
  return url;
}
