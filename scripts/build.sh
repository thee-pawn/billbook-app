#!/usr/bin/env bash
# =============================================================================
# build.sh – Full build pipeline for BillBook Electron app
#
# Usage:
#   ./scripts/build.sh          # build only (no publish)
#   PUBLISH=true ./scripts/build.sh  # build + publish to GitHub Releases
#
# Requirements:
#   - Node.js ≥ 18 and npm on the build machine
#   - GH_TOKEN set (or in .env) for the --publish step
#
# Playwright browser binaries are NOT bundled here.
# On the user's first launch a dedicated setup window downloads Chromium
# automatically into the app's userData folder — no internet connection is
# needed by the user after that point.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # billbook-app/
WORKSPACE="$(cd "$ROOT_DIR/.." && pwd)"           # Billbook/

FRONTEND_DIR="$WORKSPACE/billbook-fe"
BACKEND_DIR="$WORKSPACE/whatsapp_automation"

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RESET="\033[0m"

step() { echo -e "\n${BOLD}${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✔ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }

# ── Load .env if present ──────────────────────────────────────────────────────
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
  ok "Loaded .env"
fi

# ── Step 1: Install root (Electron) dependencies ─────────────────────────────
step "1/5  Installing Electron dependencies"
cd "$ROOT_DIR"
if [ ! -d node_modules ]; then
  npm install
fi
ok "Electron deps ready"

# ── Step 2: Build frontend ────────────────────────────────────────────────────
step "2/5  Building frontend (billbook-fe)"
cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  warn "node_modules not found — running npm install in billbook-fe"
  npm install
fi
npm run build
ok "Frontend built → $FRONTEND_DIR/dist/"

# ── Step 3: Install backend dependencies ─────────────────────────────────────
step "3/5  Checking backend dependencies (whatsapp_automation)"
cd "$BACKEND_DIR"
if [ ! -d node_modules ]; then
  warn "node_modules not found — running npm install in whatsapp_automation"
  npm install
fi
ok "Backend deps ready"

# ── Step 4: Bundle backend with esbuild ──────────────────────────────────────
step "4/5  Bundling backend with esbuild"
cd "$ROOT_DIR"

mkdir -p "$BACKEND_DIR/dist"

# playwright and playwright-core are kept external because they contain native
# binaries that cannot be inlined. They are copied to extraResources instead.
npx esbuild "$BACKEND_DIR/src/server.ts" \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile="$BACKEND_DIR/dist/server.js" \
  --external:playwright \
  --external:playwright-core \
  --external:electron

ok "Backend bundled → $BACKEND_DIR/dist/server.js"

# ── Step 5: Package with electron-builder ────────────────────────────────────
cd "$ROOT_DIR"

if [ "${PUBLISH:-false}" = "true" ]; then
  step "5/5  Building + publishing release (electron-builder --publish always)"
  if [ -z "${GH_TOKEN:-}" ]; then
    echo "ERROR: GH_TOKEN is not set. Copy .env.example → .env and fill in your token."
    exit 1
  fi
  npx electron-builder --publish always
else
  step "5/5  Building installer (electron-builder)"
  npx electron-builder
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}✔ Done! Installers are in:${RESET}  $ROOT_DIR/dist/"
ls "$ROOT_DIR/dist/" 2>/dev/null || true
