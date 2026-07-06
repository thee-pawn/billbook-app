import { app, BrowserWindow, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const MAIN_CONTENT_BASELINE_WIDTH = 1280;
const MAIN_CONTENT_BASELINE_HEIGHT = 800;
const MAIN_ZOOM_MIN = 0.5;
const MAIN_ZOOM_MAX = 1;
const MAIN_ZOOM_MANUAL_MIN = 0.25;
const MAIN_ZOOM_MANUAL_MAX = 3;
const ZOOM_STATE_FILE = 'main-window-zoom.json';

interface ZoomState {
  manual: boolean;
  factor: number | null;
}

function clampManualZoom(factor: number): number {
  return Math.max(MAIN_ZOOM_MANUAL_MIN, Math.min(MAIN_ZOOM_MANUAL_MAX, factor));
}

function getZoomStatePath(): string {
  return path.join(app.getPath('userData'), ZOOM_STATE_FILE);
}

function loadZoomState(): ZoomState {
  try {
    const data = JSON.parse(fs.readFileSync(getZoomStatePath(), 'utf8')) as {
      manual?: boolean;
      factor?: number;
    };
    if (data.manual && typeof data.factor === 'number' && data.factor > 0) {
      return { manual: true, factor: clampManualZoom(data.factor) };
    }
  } catch {
    // No saved state yet.
  }
  return { manual: false, factor: null };
}

function saveZoomState(factor: number): number {
  const clamped = clampManualZoom(factor);
  try {
    fs.writeFileSync(
      getZoomStatePath(),
      JSON.stringify({ manual: true, factor: clamped }),
      'utf8',
    );
  } catch {
    // ignore
  }
  return clamped;
}

function clearZoomState(): void {
  try {
    fs.unlinkSync(getZoomStatePath());
  } catch {
    // File may not exist.
  }
}

export function getDefaultMainWindowSize(): { width: number; height: number } {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const margin = 32;
  const preferredW = 1200;
  const preferredH = 800;
  const width = Math.max(900, Math.min(preferredW, workAreaSize.width - margin));
  const height = Math.max(480, Math.min(preferredH, workAreaSize.height - margin));
  return { width, height };
}

function getAdaptiveZoomFactor(win: BrowserWindow): number {
  const { width: cw, height: ch } = win.getContentBounds();
  if (cw <= 0 || ch <= 0) return 1;
  const widthFactor = cw / MAIN_CONTENT_BASELINE_WIDTH;
  const heightFactor = ch / MAIN_CONTENT_BASELINE_HEIGHT;
  const factor = Math.min(widthFactor, heightFactor);
  return Math.max(MAIN_ZOOM_MIN, Math.min(MAIN_ZOOM_MAX, factor));
}

function setWindowZoomFactor(win: BrowserWindow, factor: number): void {
  if (win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isDestroyed()) return;
  (win as BrowserWindow & { __suppressZoomPersist?: boolean }).__suppressZoomPersist = true;
  try {
    wc.setZoomFactor(factor);
  } catch {
    // ignore
  }
  setImmediate(() => {
    (win as BrowserWindow & { __suppressZoomPersist?: boolean }).__suppressZoomPersist = false;
  });
}

function applyMainWindowZoom(win: BrowserWindow, zoomState: ZoomState): void {
  if (zoomState.manual && zoomState.factor != null) {
    setWindowZoomFactor(win, zoomState.factor);
    return;
  }
  setWindowZoomFactor(win, getAdaptiveZoomFactor(win));
}

export function attachMainWindowZoom(win: BrowserWindow): void {
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let zoomState = loadZoomState();

  const apply = () => applyMainWindowZoom(win, zoomState);

  const scheduleAdaptiveResize = () => {
    if (zoomState.manual) return;
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 48);
  };

  win.on('resize', scheduleAdaptiveResize);
  win.webContents.on('did-finish-load', apply);
  win.once('ready-to-show', () => setTimeout(apply, 0));

  win.webContents.on('zoom-changed', () => {
    const suppress = (win as BrowserWindow & { __suppressZoomPersist?: boolean }).__suppressZoomPersist;
    if (suppress) return;
    const factor = win.webContents.getZoomFactor();
    zoomState = { manual: true, factor: saveZoomState(factor) };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (!(input.control || input.meta) || input.type !== 'keyDown') return;
    if (input.key !== '0') return;
    event.preventDefault();
    zoomState = { manual: false, factor: null };
    clearZoomState();
    setWindowZoomFactor(win, getAdaptiveZoomFactor(win));
  });

  win.on('close', () => {
    if (win.isDestroyed()) return;
    try {
      if (zoomState.manual) {
        saveZoomState(win.webContents.getZoomFactor());
      }
    } catch {
      // ignore
    }
  });
}
