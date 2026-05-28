'use strict';

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const log = require('electron-log');

let backendProcess = null;

/** Actual listen port after startup (may differ from env PORT if 4242 was busy). */
let resolvedBackendPort = 4242;

/**
 * Spawns the WhatsApp automation backend as a child process and waits until
 * the HTTP server is actually accepting requests before resolving.
 *
 * Two signals are used in combination:
 *  1. `BILLBOOK_BACKEND_PORT=<n>` written to stdout by server.ts — signals
 *     that Express has bound the port.
 *  2. A health-check poll of GET /api/health as a belt-and-suspenders fallback.
 *
 * Packaged mode:  uses process.execPath (the Electron binary) with
 *                 ELECTRON_RUN_AS_NODE=1 so it acts as a plain Node runtime —
 *                 no Node.js installation required on the end-user's machine.
 *
 * Development:    uses the local `node` binary for simplicity.
 */
function startBackend() {
  // Avoid orphaned backends (and singleton lock conflicts) if start is called twice.
  return stopBackend().then(() => startBackendProcess());
}

function startBackendProcess() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'dist', 'server.js')
    : path.join(__dirname, '../../whatsapp_automation/dist', 'server.js');

  const backendCwd = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '../../whatsapp_automation');

  const nodeModulesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'node_modules')
    : path.join(__dirname, '../../whatsapp_automation/node_modules');

  const playwrightBrowsersPath = path.join(app.getPath('userData'), 'playwright-browsers');

  const nodeBin = app.isPackaged ? process.execPath : 'node';

  log.info(`[Backend] Starting: ${nodeBin} ${serverPath}`);

  backendProcess = spawn(nodeBin, [serverPath], {
    cwd: backendCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '4242',
      NODE_ENV: 'production',
      NODE_PATH: nodeModulesPath,
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
      USER_DATA_DIR: path.join(app.getPath('userData'), 'session_data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.on('exit', (code, signal) => {
    log.info(`[Backend] Process exited — code: ${code}, signal: ${signal}`);
    backendProcess = null;
  });

  backendProcess.on('error', (err) => {
    log.error('[Backend] Failed to start process:', err.message);
  });

  // ── Wait for the backend to be ready ───────────────────────────────────────
  return new Promise((resolve) => {
    let resolved = false;
    let detectedPort = 4242; // default; updated from stdout signal

    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimeout);
      clearInterval(pollInterval);
      resolvedBackendPort = detectedPort;
      log.info(`[Backend] Ready on port ${detectedPort}`);
      resolve();
    };

    // Hard cap: open the window anyway after 15 s even if health-check never
    // succeeds (e.g. slow machine / antivirus scanning the process).
    const hardTimeout = setTimeout(() => {
      log.warn('[Backend] Startup timeout reached — opening window anyway');
      done();
    }, 15000);

    // ── Signal 1: stdout "BILLBOOK_BACKEND_PORT=<n>" ─────────────────────────
    // server.ts writes this the moment Express calls its listen() callback.
    let stdoutBuffer = '';
    backendProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;
      log.info(`[Backend] ${text.trimEnd()}`);

      const match = stdoutBuffer.match(/BILLBOOK_BACKEND_PORT=(\d+)/);
      if (match) {
        detectedPort = parseInt(match[1], 10);
        // The port signal means the TCP socket is bound — we're ready.
        done();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      log.warn(`[Backend] ${data.toString().trimEnd()}`);
    });

    // ── Signal 2: health-check poll (belt-and-suspenders) ────────────────────
    // Start polling after a short head-start so we don't hammer the port
    // before the process has even had time to load Node modules.
    const pollInterval = setInterval(() => {
      if (resolved) { clearInterval(pollInterval); return; }

      const req = http.get(
        `http://127.0.0.1:${detectedPort}/api/health`,
        { timeout: 1000 },
        (res) => {
          if (res.statusCode === 200) done();
          res.resume(); // discard body
        },
      );
      req.on('error', () => { /* still starting — ignore */ });
      req.on('timeout', () => req.destroy());
    }, 500);
  });
}

/**
 * Gracefully terminates the backend child process and waits for it to exit.
 */
function stopBackend() {
  return new Promise((resolve) => {
    if (!backendProcess) {
      resolve();
      return;
    }
    log.info('[Backend] Stopping backend process…');
    const proc = backendProcess;
    backendProcess = null;

    const forceKillTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(forceKillTimer);
      log.info('[Backend] Process stopped.');
      resolve();
    });

    try { proc.kill('SIGTERM'); } catch { clearTimeout(forceKillTimer); resolve(); }
  });
}

function getBackendPort() {
  return resolvedBackendPort;
}

module.exports = { startBackend, stopBackend, getBackendPort };
