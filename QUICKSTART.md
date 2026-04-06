# Quick Start Guide

## Prerequisites

- **macOS/Linux/Windows**: The app will auto-install dependencies
- **Disk Space**: At least 5GB free
- **Internet**: Required for downloading dependencies and repositories

## Configuration

### 1. Copy the example config

```bash
cp config.local.json.example config.local.json
```

### 2. Edit `config.local.json`

Open the file and update with your actual values:

```json
{
  "githubToken": "ghp_your_token_here",
  "backendRepoUrl": "https://github.com/your-org/backend.git",
  "frontendRepoUrl": "https://github.com/your-org/frontend.git",
  "backendStartCommand": "npm run start",
  "frontendBuildCommand": "npm run build",
  "frontendStartCommand": "npm run start",
  "appName": "BillBook Application",
  "backendPort": 3001,
  "frontendPort": 3000,
  "initialBranch": "main"
}
```

### 3. GitHub Personal Access Token (for private repos)

If your repositories are private, you need a GitHub Personal Access Token:

1. Go to [GitHub Settings → Personal Access Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "BillBook Electron App")
4. Select the `repo` scope (for private repositories)
5. Click "Generate token"
6. Copy the token and paste it in `config.local.json` as `githubToken`

**IMPORTANT**: Keep this token secret! Add `config.local.json` to `.gitignore` (already done).

## Alternative: Environment Variables

Instead of `config.local.json`, you can use environment variables:

```bash
export GITHUB_TOKEN="ghp_your_token_here"
export BACKEND_REPO_URL="https://github.com/your-org/backend.git"
export FRONTEND_REPO_URL="https://github.com/your-org/frontend.git"
export BACKEND_PORT=3001
export FRONTEND_PORT=3000
```

## Development

### Install dependencies

```bash
npm install
```

This will also automatically install Electron dependencies in `src/electron/`.

### Run in development mode

```bash
npm run dev
```

This will:
1. Compile TypeScript
2. Launch Electron
3. Show the initialization window
4. Auto-install dependencies if needed
5. Clone/update repositories
6. Start backend and frontend services
7. Open the main application

### Development Tips

- Press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux) to open DevTools
- Set `NODE_ENV=development` to auto-open DevTools on init window
- Logs are stored in `~/Library/Application Support/billbook-app/logs/` (macOS)

## Building Distribution

### Build for your current platform

```bash
npm run dist
```

### Build for specific platforms

```bash
# Windows installer (NSIS)
npm run dist:win

# macOS DMG
npm run dist:mac

# Linux AppImage
npm run dist:linux
```

### Output

Installers will be created in the `dist/` folder:

- **Windows**: `dist/BillBook Application Setup 1.0.0.exe`
- **macOS**: `dist/BillBook Application-1.0.0.dmg`
- **Linux**: `dist/BillBook Application-1.0.0.AppImage`

## Distribution

### Windows

Users can run the `.exe` installer. It will:
- Install the application
- Create desktop and start menu shortcuts
- On first run, auto-install Git and Node.js if needed

### macOS

Users can open the `.dmg` and drag the app to Applications. On first run:
- May need to right-click → Open (for unsigned apps)
- Will auto-install Git and Node.js via Homebrew if needed
- May require admin password for Homebrew installation

### Linux

Users can run the `.AppImage`:

```bash
chmod +x BillBook\ Application-1.0.0.AppImage
./BillBook\ Application-1.0.0.AppImage
```

On first run, may need sudo access to install Git and Node.js.

## Troubleshooting

### Port already in use

If ports 3000 or 3001 are in use:

1. Edit `config.local.json` to use different ports
2. Or kill the processes using those ports:

```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### GitHub authentication fails

- Verify your token has the `repo` scope
- Check if token is expired
- Ensure URL format is correct: `https://github.com/org/repo.git`
- For public repos, you can omit the `githubToken`

### Build fails

```bash
# Clean and rebuild
npm run clean
rm -rf node_modules src/electron/node_modules
npm install
npm run build:electron
npm run dist
```

### Services won't start

1. Check logs in the initialization window (click "Show Logs")
2. Check log files in user data directory
3. Ensure `package.json` exists in both repos
4. Verify the start commands are correct

## File Locations

- **macOS**: `~/Library/Application Support/billbook-app/`
- **Windows**: `%APPDATA%/billbook-app/`
- **Linux**: `~/.config/billbook-app/`

Inside this directory:
```
billbook-app/
├── repos/
│   ├── backend/     # Backend repository
│   └── frontend/    # Frontend repository
├── dependencies/    # Downloaded installers
└── logs/           # Service logs
    ├── backend.log
    └── frontend.log
```

## Next Steps

1. Customize `src/electron/src/config.ts` with your defaults
2. Replace the logo in `src/renderer/init.html` with your own
3. Update `package.json` with your app name and details
4. Create proper icons for distribution:
   - `build/icon.ico` (Windows, 256x256)
   - `build/icon.icns` (macOS, multiple sizes)
   - `build/icon.png` (Linux, 512x512)

## Support

For issues or questions:
- Check the logs in the initialization window
- Review the full logs in the user data directory
- Open an issue on GitHub
