import * as path from 'path';
import * as fs from 'fs';

/**
 * Application Configuration
 *
 * CUSTOMIZE THESE VALUES FOR YOUR APPLICATION:
 */

export interface AppConfig {
  // Commands
  backendBuildCommand?: string;
  backendStartCommand: string;
  frontendBuildCommand: string;
  frontendStartCommand: string;

  // Application metadata
  appName: string;

  // Ports
  backendPort: number;
  frontendPort: number;

  // Custom frontend environment variables (optional)
  // These will be written to .env.production
  frontendEnv?: Record<string, string>;
}

/**
 * Default configuration
 * EDIT THESE VALUES or override via config.local.json
 */
const defaultConfig: AppConfig = {
  // npm commands to run
  backendStartCommand: 'node dist/server.js',
  frontendBuildCommand: 'npm run build',
  frontendStartCommand: 'npm run start',

  // Application metadata
  appName: 'BillBook Application',

  // Service ports
  backendPort: 4242,
  frontendPort: 5173,
};

/**
 * Load configuration from file or environment.
 * Priority: config.local.json > environment variables > defaultConfig
 */
export function loadConfig(userDataPath: string, appPath?: string): AppConfig {
  let config = { ...defaultConfig };

  // Try multiple locations for config.local.json
  const configLocations = [
    // 1. Packaged app root (production) — inside app.asar
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

        // Strip any legacy fields that should no longer be in the config
        // (githubToken, backendRepoUrl, frontendRepoUrl, initialBranch)
        // so they cannot accidentally re-activate removed code paths.
        const {
          githubToken: _gt,
          backendRepoUrl: _br,
          frontendRepoUrl: _fr,
          initialBranch: _ib,
          appId: _ai,
          ...safeConfig
        } = localConfig;

        config = { ...config, ...safeConfig };
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
    console.warn('\nSearched locations:');
    configLocations.forEach((loc, i) => {
      console.warn(`  ${i + 1}. ${loc} ${fs.existsSync(loc) ? '✓ EXISTS (but failed to parse)' : '✗ NOT FOUND'}`);
    });
    console.warn('\n💡 To fix: Place config.local.json in the app directory or user data directory.');
  } else {
    console.log('✅ Configuration loaded successfully!');
  }

  // Environment variable overrides (ports and app name only)
  if (process.env.BACKEND_PORT) {
    config.backendPort = parseInt(process.env.BACKEND_PORT, 10);
  }
  if (process.env.FRONTEND_PORT) {
    config.frontendPort = parseInt(process.env.FRONTEND_PORT, 10);
  }

  return config;
}
