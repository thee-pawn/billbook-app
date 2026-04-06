'use strict';

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

// Written to userData once browsers are successfully installed.
// Deleted or absent → setup window runs again on next launch.
const MARKER_FILE = 'playwright-setup-complete';

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
 * The directory where Playwright will store (and later find) browser binaries.
 * Stored inside userData so it survives app updates and is writable on all OSes.
 */
function getBrowsersPath() {
  return path.join(app.getPath('userData'), 'playwright-browsers');
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

    // Playwright's CLI entry point — cross-platform, no shell script needed.
    const playwrightCli = app.isPackaged
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

    log.info(`[Setup] Running playwright install chromium`);
    log.info(`[Setup] Browsers path: ${browsersPath}`);
    log.info(`[Setup] CLI path: ${playwrightCli}`);

    // process.execPath is the Electron binary; with ELECTRON_RUN_AS_NODE=1 it
    // behaves as a plain Node.js runtime — no Node installation required.
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

module.exports = { isSetupComplete, installBrowsers, getBrowsersPath };
