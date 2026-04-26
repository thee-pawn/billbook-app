'use strict';

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

// Written to userData once browsers are successfully installed.
// Deleted or absent → setup window runs again on next launch.
const MARKER_FILE = 'playwright-setup-complete';

function getPlaywrightCliPath() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        'backend',
        'node_modules',
        'playwright',
        'cli.js'
      )
    : path.join(
        __dirname,
        '../../whatsapp_automation/node_modules/playwright/cli.js'
      );
}

/**
 * The directory where Playwright will store (and later find) browser binaries.
 * Stored inside userData so it survives app updates and is writable on all OSes.
 */
function getBrowsersPath() {
  return path.join(app.getPath('userData'), 'playwright-browsers');
}

/**
 * Playwright stores browsers under PLAYWRIGHT_BROWSERS_PATH in folders like `chromium-1234`.
 */
function hasChromiumBrowsersInstalled(browsersPath) {
  if (!fs.existsSync(browsersPath)) return false;
  try {
    const entries = fs.readdirSync(browsersPath);
    return entries.some((name) => /^chromium/i.test(name));
  } catch {
    return false;
  }
}

/**
 * Returns true if Playwright Chromium has already been installed on this machine.
 */
function isSetupComplete() {
  return fs.existsSync(path.join(app.getPath('userData'), MARKER_FILE));
}

/**
 * Writes the completion marker. Called only after a successful install.
 */
function markSetupComplete() {
  fs.writeFileSync(
    path.join(app.getPath('userData'), MARKER_FILE),
    new Date().toISOString()
  );
}

/**
 * Whether first-run setup should run: missing marker, missing Chromium folders,
 * or bundled Playwright CLI missing (corrupt install).
 */
function needsSetup() {
  const cli = getPlaywrightCliPath();
  if (!fs.existsSync(cli)) {
    return true;
  }

  const browsersPath = getBrowsersPath();
  const browsersOk = hasChromiumBrowsersInstalled(browsersPath);

  if (!isSetupComplete() || !browsersOk) {
    if (isSetupComplete() && !browsersOk) {
      try {
        fs.unlinkSync(path.join(app.getPath('userData'), MARKER_FILE));
      } catch (_) {
        /* ignore */
      }
    }
    return true;
  }

  return false;
}

/**
 * Packaged app: Electron binary acts as Node (ELECTRON_RUN_AS_NODE) — no separate Node install.
 * Development: requires `node` on PATH for the backend child process.
 */
function verifyNodeRuntime(onProgress) {
  return new Promise((resolve, reject) => {
    onProgress?.(
      app.isPackaged
        ? 'Checking built-in runtime (no separate Node.js install required)…'
        : 'Checking Node.js…'
    );

    const bin = app.isPackaged ? process.execPath : 'node';
    const args = ['-e', 'process.stdout.write(process.version)'];
    const child = spawn(bin, args, {
      env: app.isPackaged
        ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let version = '';
    child.stdout.on('data', (d) => {
      version += d.toString();
    });

    child.on('error', (err) => {
      reject(
        new Error(
          app.isPackaged
            ? `Built-in runtime check failed: ${err.message}`
            : 'Node.js is not installed or not on PATH. Install Node.js LTS from https://nodejs.org and try again.'
        )
      );
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            app.isPackaged
              ? 'Built-in Node runtime check failed.'
              : 'Node.js is not installed or not on PATH. Install Node.js LTS and try again.'
          )
        );
        return;
      }
      log.info(
        `[Setup] ${app.isPackaged ? 'Embedded' : 'System'} Node ${version.trim()}`
      );
      resolve();
    });
  });
}

/**
 * Verifies runtime + bundled Playwright, then downloads Chromium if needed.
 */
function ensurePlaywrightBrowsers(onProgress) {
  return verifyNodeRuntime(onProgress)
    .then(() => {
      onProgress?.('Verifying Playwright package…');
      const cli = getPlaywrightCliPath();
      if (!fs.existsSync(cli)) {
        throw new Error(
          'Playwright is missing from this installation. Reinstall BillBook or contact support.'
        );
      }
      return installBrowsers(onProgress);
    });
}

/**
 * Spawns `playwright install chromium` using the Electron binary as the Node
 * runtime (ELECTRON_RUN_AS_NODE=1), so no separate Node.js install is needed
 * on the user's machine.
 *
 * @param {(msg: string) => void} [onProgress] - called with each line of output
 * @returns {Promise<void>} resolves on success, rejects on non-zero exit
 */
function installBrowsers(onProgress) {
  return new Promise((resolve, reject) => {
    const browsersPath = getBrowsersPath();
    fs.mkdirSync(browsersPath, { recursive: true });

    const playwrightCli = getPlaywrightCliPath();

    log.info(`[Setup] Running playwright install chromium`);
    log.info(`[Setup] Browsers path: ${browsersPath}`);
    log.info(`[Setup] CLI path: ${playwrightCli}`);

    // process.execPath is the Electron binary; with ELECTRON_RUN_AS_NODE=1 it
    // behaves as a plain Node.js runtime — no Node installation required.
    onProgress?.('Downloading Playwright Chromium (one-time)…');

    const child = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const emit = (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      log.info('[Setup]', msg);
      onProgress?.(msg);
    };

    child.stdout.on('data', emit);
    child.stderr.on('data', emit);

    child.on('error', (err) => {
      log.error('[Setup] spawn error:', err);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        markSetupComplete();
        log.info('[Setup] Browser installation complete.');
        resolve();
      } else {
        reject(new Error(`playwright install exited with code ${code}`));
      }
    });
  });
}

module.exports = {
  isSetupComplete,
  needsSetup,
  verifyNodeRuntime,
  ensurePlaywrightBrowsers,
  installBrowsers,
  getBrowsersPath,
  getPlaywrightCliPath,
};
