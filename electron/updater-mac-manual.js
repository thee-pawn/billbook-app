'use strict';

const { app } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * macOS manual update — bypasses Squirrel.Mac/ShipIt which fails on unsigned apps.
 * Extracts the downloaded ZIP, verifies critical bundled files, swaps the .app, relaunches.
 */
async function macManualUpdate({ log, stopBackendFn, sendProgress }) {
  const runningAppPath = path.dirname(path.dirname(path.dirname(process.execPath)));

  if (!runningAppPath.endsWith('.app')) {
    log.error('[Updater] Cannot determine .app path from execPath:', process.execPath);
    throw new Error('Cannot determine app bundle path');
  }

  log.info('[Updater] macOS manual update — running app:', runningAppPath);

  const cacheDir = path.join(app.getPath('userData'), 'Caches', `${app.getName()}-updater`);
  let updateCacheDir = cacheDir;
  if (!fs.existsSync(updateCacheDir)) {
    const altCache = path.join(app.getPath('home'), 'Library', 'Caches', `${app.name}-updater`);
    if (fs.existsSync(altCache)) updateCacheDir = altCache;
  }

  const pendingDir = path.join(updateCacheDir, 'pending');
  const searchDirs = [pendingDir, updateCacheDir];
  let zipPath;
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const zips = fs.readdirSync(dir).filter((f) => f.endsWith('.zip'));
    if (zips.length > 0) {
      zipPath = path.join(dir, zips[zips.length - 1]);
      break;
    }
  }

  if (!zipPath || !fs.existsSync(zipPath)) {
    log.error('[Updater] Could not find downloaded update ZIP in:', searchDirs);
    throw new Error('Downloaded update ZIP not found');
  }

  log.info('[Updater] Found update ZIP:', zipPath);
  sendProgress?.('Extracting update…', 30);

  const tmpDir = path.join(app.getPath('temp'), 'billbook-update-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(`ditto -xk "${zipPath}" "${tmpDir}"`, { timeout: 120_000 });
  } catch (err) {
    log.error('[Updater] Failed to extract ZIP:', err);
    throw new Error('Failed to extract update');
  }

  const extracted = fs.readdirSync(tmpDir);
  const newAppName = extracted.find((f) => f.endsWith('.app'));
  if (!newAppName) {
    log.error('[Updater] No .app found in extracted ZIP. Contents:', extracted);
    throw new Error('No .app found in update package');
  }

  const newAppPath = path.join(tmpDir, newAppName);
  verifyUpdateBundle(newAppPath, log);

  sendProgress?.('Installing update…', 60);

  if (typeof stopBackendFn === 'function') {
    sendProgress?.('Stopping services…', 65);
    try {
      await stopBackendFn();
    } catch (err) {
      log.warn('[Updater] stopBackend error (continuing):', err);
    }
  }

  sendProgress?.('Replacing app…', 80);

  const appParentDir = path.dirname(runningAppPath);
  const appBaseName = path.basename(runningAppPath);
  const backupPath = path.join(tmpDir, appBaseName + '.old');

  try {
    fs.renameSync(runningAppPath, backupPath);
  } catch (err) {
    log.error('[Updater] Failed to move old app:', err);
    try {
      execSync(`mv "${runningAppPath}" "${backupPath}"`, { timeout: 10_000 });
    } catch (err2) {
      log.error('[Updater] Shell move also failed:', err2);
      throw new Error('Failed to replace app — is it running from a read-only volume?');
    }
  }

  const installedPath = path.join(appParentDir, appBaseName);
  try {
    fs.renameSync(newAppPath, installedPath);
  } catch (err) {
    log.error('[Updater] Failed to move new app into place:', err);
    try {
      execSync(`cp -R "${newAppPath}" "${installedPath}"`, { timeout: 60_000 });
    } catch (err2) {
      log.error('[Updater] Shell copy also failed — restoring backup:', err2);
      try {
        fs.renameSync(backupPath, runningAppPath);
      } catch { /* ignore */ }
      throw new Error('Failed to install update');
    }
  }

  sendProgress?.('Restarting…', 95);
  await new Promise((r) => setTimeout(r, 500));

  log.info('[Updater] macOS manual update complete — relaunching');

  try {
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch { /* ignore */ }

  // Use the current executable name — safer than app.getName() which can differ from CFBundleExecutable.
  const execName = path.basename(process.execPath);
  const newExecPath = path.join(installedPath, 'Contents', 'MacOS', execName);

  spawn(newExecPath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  }).unref();

  setTimeout(() => app.exit(0), 300);
}

function verifyUpdateBundle(appPath, log) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  const required = [
    path.join(resources, 'backend', 'dist', 'server.js'),
    path.join(resources, 'frontend', 'index.html'),
  ];
  const playwrightCandidates = [
    path.join(resources, 'backend', 'node_modules', 'playwright', 'cli.js'),
    path.join(resources, 'backend', 'node_modules', 'playwright-core', 'cli.js'),
  ];

  const missing = required.filter((p) => !fs.existsSync(p));
  const hasPlaywright = playwrightCandidates.some((p) => fs.existsSync(p));

  if (missing.length > 0 || !hasPlaywright) {
    log.error('[Updater] Update bundle failed integrity check', { missing, hasPlaywright, appPath });
    throw new Error('Downloaded update is incomplete — please download the installer from GitHub Releases.');
  }

  log.info('[Updater] Update bundle integrity check passed');
}

module.exports = { macManualUpdate };
