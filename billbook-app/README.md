# BillBook Electron Application

This is the root orchestrator for the BillBook Electron desktop application, combining the frontend and backend submodules into a single distributable application.

## Structure

```
billbook-app/
├── main.js              # Electron main process
├── package.json         # Root package.json with Electron config
├── frontend/            # Frontend submodule (React + Vite)
│   └── dist/            # Built frontend files (generated)
└── backend/             # Backend submodule (TypeScript + Express)
    ├── src/             # TypeScript source files
    └── dist/            # Compiled JavaScript files (generated)
```

## Setup

1. **Install all dependencies:**
   ```bash
   npm run install-all
   ```
   This installs dependencies in root, frontend, and backend directories.

2. **Build the frontend:**
   ```bash
   npm run build-frontend
   ```
   This creates the production build in `frontend/dist/`.
   
   > **Note for Windows ARM64 users:** If you encounter a Rollup/Vite error about missing DLLs, you may need to install the [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.arm64.exe). Alternatively, ensure `frontend/node_modules` is properly installed with `cd frontend && npm install`.

3. **Build the backend:**
   ```bash
   npm run build-backend
   ```
   This compiles the TypeScript backend code to JavaScript in `backend/dist/`.

4. **Run in development mode:**
   
   **Option A: Use built frontend (recommended for quick start):**
   ```bash
   npm run build-frontend && npm run build-backend && npm run dev
   ```
   This builds both frontend and backend, then starts Electron.
   
   **Option B: Use frontend dev server (for hot reload):**
   
   In **Terminal 1** (start frontend dev server):
   ```bash
   npm run dev:frontend
   ```
   This starts the Vite dev server on `http://localhost:5173`
   
   In **Terminal 2** (start Electron):
   ```bash
   npm run build-backend && npm run dev:electron
   ```
   This builds the backend and starts Electron, which will connect to the dev server.
   
   > **Note:** The `npm run dev` command automatically builds the backend. For frontend, either build it first or start the dev server separately.

5. **Run in production mode:**
   ```bash
   npm start
   ```
   Runs Electron with the built frontend and backend.
   > **Note:** Ensure both frontend and backend are built before running.

## Building for Distribution

### Build for all platforms:
```bash
npm run build
```

### Build for specific platform:
```bash
npm run build:mac      # macOS (DMG)
npm run build:win      # Windows (NSIS installer)
npm run build:linux    # Linux (AppImage)
```

The build process:
1. Builds the frontend (`npm run build-frontend`) - compiles React app to static files
2. Prepares backend for distribution (`npm run prepare-backend-dist`) which:
   - Installs all dependencies (including dev) in backend
   - Compiles TypeScript to JavaScript (`npm run build`)
   - Reinstalls only production dependencies (`npm install --omit=dev`)
3. Packages everything with electron-builder

Output will be in `dist-electron/` directory.

### What Users Get

**Yes, this creates a single standalone Electron distribution that includes everything!**

When you run the build command, it creates a single installer/package (DMG for Mac, NSIS installer for Windows, AppImage for Linux) that includes:

✅ **Complete Frontend**: Built React/Vite static files  
✅ **Complete Backend**: Compiled JavaScript (`dist/` folder) + all production `node_modules`  
✅ **Electron Runtime**: Everything needed to run the app  
✅ **Self-Contained**: No additional installation or setup required by end users

**End users can simply:**
1. Download and install the package (or run the portable version)
2. Launch the application
3. Everything works out of the box - frontend UI loads, backend API starts automatically

**No additional steps required from users:**
- ❌ No need to install Node.js
- ❌ No need to run `npm install`
- ❌ No need to build anything
- ❌ No need to configure environment variables (unless you want custom settings)
- ❌ No need to manually start backend or frontend servers

The backend runs as a background process managed by Electron, and the frontend loads in the Electron window. Everything is bundled together.

**Important:** The backend is written in TypeScript and must be compiled before running. The build process handles this automatically, but for local development you need to build it manually:
```bash
npm run build-backend
```

## Backend Node Modules Handling

### Current Approach: Include Production Dependencies

The build process handles backend dependencies and compilation as follows:

1. **Pre-build step**: The `prepare-backend-dist` script:
   - Installs all dependencies (including dev) needed for TypeScript compilation
   - Compiles TypeScript to JavaScript using `npm run build` (outputs to `backend/dist/`)
   - Reinstalls only production dependencies (`npm install --omit=dev`) to reduce bundle size
   - Excludes devDependencies (TypeScript compiler, type definitions, etc.) from final package

2. **Packaging**: The backend (including compiled `dist/` folder and `node_modules`) is placed in `extraResources`:
   - Located outside the asar archive for better performance
   - Accessible to the forked Node.js process
   - Includes all production dependencies needed to run the backend server
   - Only compiled JavaScript is included (TypeScript source files are excluded)

3. **Size Optimization**: The following are excluded from the build:
   - TypeScript source files (`src/**/*`, `*.ts`, `tsconfig.json`)
   - Test files (`tests/**`, `*.test.js`)
   - Development dependencies (via `--production` flag)
   - Cache files (`node_modules/.cache/**`)
   - Environment files (`.env*`)
   - IDE files (`.iml`, etc.)

### Alternative Approaches (if you need even smaller size)

If the app size is still too large, consider these alternatives:

#### Option 1: Bundle Backend with pkg/nexe
- Use `pkg` or `nexe` to create a single executable for the backend
- Excludes all node_modules from the final package
- Requires testing to ensure all dependencies work with bundling

#### Option 2: Install Dependencies at Runtime
- Exclude backend node_modules from the build
- Include a setup script that runs `npm install --production` on first launch
- More complex but results in smaller initial download

#### Option 3: Use Native Modules Optimization
- Manually prune unnecessary native modules
- Use `electron-builder`'s `asarUnpack` selectively for native modules only
- Requires careful dependency analysis

For most use cases, the current approach (production dependencies only) provides a good balance between size and simplicity.

## How It Works

1. **Main Process** (`main.js`):
   - Starts the backend server using `child_process.fork()` (runs `backend/dist/server.js`)
   - Creates the Electron BrowserWindow
   - Loads the frontend from `frontend/dist/index.html`
   - Manages backend process lifecycle (start/stop)

2. **Backend Process**:
   - Runs as a separate Node.js process from compiled JavaScript (`dist/server.js`)
   - TypeScript source code is compiled to JavaScript during build
   - Serves the API on port 3000 (configurable via environment variables)
   - Automatically started when Electron launches
   - Cleanly terminated when Electron quits

3. **Frontend**:
   - Built static files (React/Vite output) served from the Electron window
   - Communicates with backend API (should be configured to use `http://localhost:3000`)
   - No build-time server needed in production

## Environment Variables

The backend respects environment variables set in:
- `backend/.env.development` (for development)
- `backend/.env.production` (for production)

Set `PORT`, `NODE_ENV`, database credentials, etc. in these files.

## Troubleshooting

### Backend won't start
- Check that `backend/dist/server.js` exists (backend must be built first)
- Build the backend: `npm run build-backend`
- Verify backend dependencies are installed: `cd backend && npm install`
- Check console logs for error messages
- Ensure TypeScript compilation succeeded without errors

### Frontend not loading
- Ensure frontend is built: `npm run build-frontend`
- Check that `frontend/dist/index.html` exists
- In dev mode, the app will try to use Vite dev server at `http://localhost:5173`

### Build fails
- Make sure all submodules are initialized and up to date
- Run `npm run install-all` to ensure all dependencies are installed
- Check that TypeScript compilation succeeds: `cd backend && npm run build`
- Verify frontend build completes successfully: `npm run build-frontend`
- Check that you have sufficient disk space for the build output
- Review error messages in the console for specific issues

### TypeScript compilation errors
- Run `cd backend && npm run build` to see detailed TypeScript errors
- Ensure all TypeScript dependencies are installed (should be in devDependencies)
- Check `backend/tsconfig.json` configuration

