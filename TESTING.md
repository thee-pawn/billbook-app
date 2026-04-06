# How to Test the BillBook App

## Prerequisites

1. **Config** – Ensure `config.local.json` exists in the project root with your repo URLs and (for private repos) `githubToken`. You already have this.
2. **Node.js** – For development you need Node (v18+) and npm on your machine.

---

## 1. Test in development (fastest)

Runs the Electron app with your local code; uses the same first-time / V2 logic.

```bash
# From project root
npm install
npm run dev
```

**What happens:**

- **First run (no existing app data):** Init window appears → installs dependencies (on Windows: portable Node/Git, VC++), clones repos, `npm install` + build for backend/frontend, starts services, then main window loads.
- **Later runs (V2 “ready”):** Single window shows “Starting backend and frontend…” then loads the app (no full install again). In the background, update check runs (git pull + npm install); if updates were applied you get “Restart to apply.”

**Where data lives in dev:**

- macOS: `~/Library/Application Support/Electron/` (or the app name from `appId`)
- Windows: `%APPDATA%\Electron\` (or your app name)
- Linux: `~/.config/Electron/` (or your app name)

Repos are under `.../repos/backend` and `.../repos/frontend`. Portable Node/Git (Windows) and VC++ installer download live under `.../dependencies/` and `.../portable/`.

---

## 2. Reset and re-test “first-time” setup

To simulate a fresh install again (see init window, portable install, VC++, clone, build):

**macOS:**

```bash
rm -rf ~/Library/Application\ Support/Electron/repos
rm -f ~/Library/Application\ Support/Electron/.v2-ready
# Optional: remove portable deps so Windows path is tested on Windows
# Then run:
npm run dev
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force $env:APPDATA\Electron\repos -ErrorAction SilentlyContinue
Remove-Item -Force $env:APPDATA\Electron\.v2-ready -ErrorAction SilentlyContinue
# Optional: remove portable Node/Git to re-test that path
# Remove-Item -Recurse -Force $env:APPDATA\Electron\portable -ErrorAction SilentlyContinue
```

Then run `npm run dev` again. You should see the init window and full setup.

---

## 3. Test the packaged app

### macOS

```bash
npm run build:electron
npm run dist:mac
```

Open the `.dmg` from `dist/`, install, then launch the app. First run = full setup; next runs = V2 “start services only” + update check.

### Windows (real machine or VM)

```bash
npm run build:electron
npm run dist:win
```

Use **`dist/BillBook Application-1.0.0-x64-Setup.exe`** on a 64‑bit PC. Install and run:

- **First run:** Portable Node, portable Git, VC++ (one UAC if needed), clone, install, build, start services.
- **Second run:** Only starts backend + frontend; update check in background.

To re-test first-time on Windows, delete:

- `%APPDATA%\billbook-app\repos`
- `%APPDATA%\billbook-app\.v2-ready`
- Optionally `%APPDATA%\billbook-app\portable` and `%APPDATA%\billbook-app\dependencies`

then run the installed app again.

---

## 4. What to verify

| What to test              | How |
|---------------------------|-----|
| First-time setup          | Run with clean app data (see §2); init window, progress, then main window. |
| Portable Node/Git (Win)   | On Windows with clean data, confirm no “Run as administrator” for Node/Git; check `%APPDATA%\billbook-app\portable\node` and `...\portable\git`. |
| VC++ handling             | On Windows without VC++ installed, first run should download and run VC++ installer (one UAC); then frontend build should succeed. |
| V2 “normal” start         | Second launch: no init window, only “Starting backend and frontend…”, then app loads. |
| Update check              | After main window loads, change something in repo (or pull new commits) and restart; you should get “Updates installed. Restart to apply.” (or see update check in logs). |
| Clean quit / ports        | Close the app; within a few seconds backend/frontend ports should be free (no “address in use” if you start the app again). |
| Persistence               | Use the app (e.g. log in); close and reopen; login/session should persist (Electron default storage). |

---

## 5. Quick reference

```bash
# Dev run (uses config.local.json)
npm run dev

# Build and package
npm run build:electron && npm run dist:win   # Windows
npm run build:electron && npm run dist:mac   # macOS

# Clean build
npm run clean && npm run build:electron && npm run dist:win
```

Logs: backend and frontend logs are written under the app data directory (e.g. `.../logs/backend.log`, `.../logs/frontend.log`). Electron/main process logs appear in the terminal when you run `npm run dev`.
