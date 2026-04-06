# BillBook Electron Distribution App

A self-contained Electron application that automatically manages dependencies, clones repositories, and starts backend/frontend services.

## Features

- ✅ Auto-installs Git, Node.js, and npm if missing
- ✅ Clones and updates repositories automatically
- ✅ Manages backend and frontend services
- ✅ Modern initialization UI with progress tracking
- ✅ Production-ready distribution builds
- ✅ Cross-platform support (Windows, macOS, Linux)

## Configuration

Edit `src/electron/src/config.ts` to customize:

```typescript
BACKEND_REPO_URL = "https://github.com/your-org/backend.git"
FRONTEND_REPO_URL = "https://github.com/your-org/frontend.git"
BACKEND_START_COMMAND = "npm run start"
FRONTEND_BUILD_COMMAND = "npm run build"
FRONTEND_START_COMMAND = "npm run start"
APP_NAME = "BillBook Application"
APP_ID = "com.billbook.app"
BACKEND_PORT = 3001
FRONTEND_PORT = 3000
INITIAL_BRANCH = "main"
```

### GitHub Authentication (for private repos)

Create a `config.local.json` file in the root directory:

```json
{
  "githubToken": "your_github_personal_access_token_here"
}
```

Or set environment variable:
```bash
export GITHUB_TOKEN=your_token_here
```

To create a GitHub Personal Access Token:
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select `repo` scope for private repositories
4. Copy the token and use it in config

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Clean build artifacts
npm run clean
```

## Building Distributables

```bash
# Build for current platform
npm run dist

# Build for specific platform
npm run dist:win    # Windows installer
npm run dist:mac    # macOS DMG
npm run dist:linux  # Linux AppImage
```

Output will be in the `dist/` folder.

## First Launch Behavior

On first launch, the app will:
1. Check and install Git if missing (~2-5 minutes)
2. Check and install Node.js if missing (~2-5 minutes)
3. Clone backend repository (~30s-2min)
4. Clone frontend repository (~30s-2min)
5. Install backend dependencies (~1-3 minutes)
6. Install frontend dependencies (~1-3 minutes)
7. Build frontend (~30s-2min)
8. Start backend service
9. Start frontend service
10. Open main application window

**Total first launch time: 5-15 minutes** (depending on internet speed)

## Subsequent Launches

On subsequent launches:
1. Pull latest code (~10s)
2. Check for dependency updates (~30s)
3. Build frontend (~30s)
4. Start services (~10s)
5. Open application (~5s)

**Total: 30-90 seconds**

## Project Structure

```
billbook-app/
├── src/
│   ├── electron/
│   │   ├── src/
│   │   │   ├── main.ts              # Main Electron process
│   │   │   ├── preload.ts           # Preload script (IPC bridge)
│   │   │   ├── dependencyManager.ts # Git/Node.js installer
│   │   │   ├── repositoryManager.ts # Git clone/pull handler
│   │   │   ├── serviceManager.ts    # Service lifecycle manager
│   │   │   ├── pathResolver.ts      # Path utilities
│   │   │   └── config.ts            # App configuration
│   │   ├── dist-electron/           # Compiled TypeScript
│   │   ├── package.json             # Electron dependencies
│   │   └── tsconfig.json            # TypeScript config
│   └── renderer/
│       ├── init.html                # Initialization UI
│       ├── init.css                 # UI styles
│       └── init.js                  # UI logic
├── package.json                     # Root package config
├── tsconfig.json                    # Root TypeScript config
└── README.md
```

## Troubleshooting

### Services won't start
- Check if ports 3000 and 3001 are available
- Check logs in initialization window
- Ensure GitHub token is valid (for private repos)

### Dependencies won't install
- Check internet connection
- Ensure sufficient disk space (5GB+ recommended)
- Check antivirus isn't blocking downloads

### Build fails
- Run `npm run clean` first
- Delete `node_modules` and reinstall
- Ensure you have build tools installed (on Windows: Visual Studio Build Tools)

## License

MIT
