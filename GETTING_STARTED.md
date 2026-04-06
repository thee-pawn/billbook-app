# Getting Started - 5 Minute Setup

## Step 1: Configure Your Repositories (2 minutes)

### Option A: Edit the config file directly

Open `src/electron/src/config.ts` and update lines 29-48:

```typescript
const defaultConfig: AppConfig = {
  // 👇 CHANGE THESE TO YOUR ACTUAL REPOS
  backendRepoUrl: "https://github.com/YOUR-ORG/backend.git",
  frontendRepoUrl: "https://github.com/YOUR-ORG/frontend.git",
  
  // 👇 CHANGE THESE IF YOUR COMMANDS ARE DIFFERENT
  backendStartCommand: "npm run start",
  frontendBuildCommand: "npm run build",
  frontendStartCommand: "npm run start",
  
  // 👇 CUSTOMIZE YOUR APP NAME
  appName: "BillBook Application",
  appId: "com.billbook.app",
  
  // 👇 CHANGE PORTS IF NEEDED
  backendPort: 3001,
  frontendPort: 3000,
  
  initialBranch: "main",
};
```

### Option B: Use a local config file (recommended)

1. Copy the example:
   ```bash
   cp config.local.json.example config.local.json
   ```

2. Edit `config.local.json`:
   ```json
   {
     "backendRepoUrl": "https://github.com/YOUR-ORG/backend.git",
     "frontendRepoUrl": "https://github.com/YOUR-ORG/frontend.git",
     "backendPort": 3001,
     "frontendPort": 3000
   }
   ```

---

## Step 2: Setup GitHub Authentication (1 minute)

### For Private Repositories

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name it: "BillBook App"
4. Select scope: `repo` ✅
5. Generate and copy the token

6. Add to `config.local.json`:
   ```json
   {
     "githubToken": "ghp_paste_your_token_here",
     "backendRepoUrl": "https://github.com/YOUR-ORG/backend.git",
     "frontendRepoUrl": "https://github.com/YOUR-ORG/frontend.git"
   }
   ```

### For Public Repositories

No authentication needed! Just use the repository URLs.

---

## Step 3: Install & Run (2 minutes)

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

The app will launch and show an initialization window. It will:
1. ✅ Check for Git, Node.js (install if missing)
2. ✅ Clone your repositories
3. ✅ Install dependencies
4. ✅ Build frontend
5. ✅ Start services
6. ✅ Open the app

**First run:** 5-15 minutes (installs dependencies)  
**Subsequent runs:** 30-90 seconds

---

## Step 4: Build Installers (Optional)

When ready to distribute:

```bash
# Build for your current platform
npm run dist

# Or build for specific platform
npm run dist:win    # Windows
npm run dist:mac    # macOS  
npm run dist:linux  # Linux
```

Installers will be in the `dist/` folder.

---

## Quick Troubleshooting

### "Authentication failed"
- ✅ Verify GitHub token is correct
- ✅ Ensure token has `repo` scope
- ✅ Check repository URLs are correct

### "Port already in use"
- ✅ Change ports in `config.local.json`
- ✅ Or kill processes on ports 3000/3001

### "npm install failed"
- ✅ Check internet connection
- ✅ Delete `node_modules` and retry
- ✅ Ensure you have disk space

---

## What's Next?

1. ✅ **Read the docs:**
   - `README.md` - Full documentation
   - `QUICKSTART.md` - Detailed quick start
   - `AUTHENTICATION.md` - Authentication options
   - `DEPLOYMENT.md` - How to distribute

2. ✅ **Customize:**
   - Update app name in `package.json`
   - Change icons in `build/` folder
   - Modify UI in `src/renderer/`

3. ✅ **Test:**
   - Run on clean machine
   - Test with real repositories
   - Verify services start correctly

4. ✅ **Distribute:**
   - Build installers
   - Upload to GitHub Releases
   - Share with users

---

## File Structure Overview

```
billbook-app/
├── src/
│   ├── electron/src/        # Main Electron code (TypeScript)
│   └── renderer/            # Initialization UI (HTML/CSS/JS)
├── package.json             # Root config & build scripts
├── config.local.json        # Your configuration (create this)
└── dist/                    # Built installers (after npm run dist)
```

---

## Need Help?

1. **Check the logs** in the initialization window (click "Show Logs")
2. **Read the documentation** files in the root
3. **Review common issues** in `QUICKSTART.md`
4. **Check file locations:**
   - macOS: `~/Library/Application Support/billbook-app/logs/`
   - Windows: `%APPDATA%/billbook-app/logs/`
   - Linux: `~/.config/billbook-app/logs/`

---

## That's It! 🎉

You now have a working Electron app that auto-deploys your backend and frontend!

**Commands to remember:**
```bash
npm run dev         # Development mode
npm run dist        # Build installer
npm run clean       # Clean build files
```

Happy coding! 🚀
