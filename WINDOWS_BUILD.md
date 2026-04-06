# Windows Distribution Build Guide

## 📦 Building for Windows

### Prerequisites

To build a Windows installer on macOS, you need:

```bash
# Install Wine (required for building Windows apps on macOS)
brew install --cask wine-stable

# Or use docker (alternative method)
# electron-builder will use docker automatically if available
```

### Build Commands

```bash
# Build Windows installer (NSIS)
npm run dist:win

# This will create:
# - dist/BillBook Application-X.X.X-Setup.exe (Installer)
# - dist/BillBook Application-X.X.X-Portable.exe (Portable version)
```

### Output Files

After building, you'll find in the `dist/` folder:

1. **`BillBook Application-1.0.0-Setup.exe`** - Full installer
   - User can choose installation directory
   - Creates desktop and start menu shortcuts
   - ~150MB

2. **`BillBook Application-1.0.0-Portable.exe`** - Portable version
   - No installation required
   - Run directly from USB or any folder
   - ~150MB

## 🎯 What's Included

The Windows distribution includes:

✅ **Auto-dependency installation:**
- Git (if not installed)
- Node.js (if not installed)
- Chromium browser (for WhatsApp automation)

✅ **Repository management:**
- Clones backend and frontend repositories
- Installs npm dependencies
- Builds and starts services

✅ **Professional installer:**
- Custom icon
- License agreement
- Installation directory selection
- Desktop & Start Menu shortcuts
- Clean uninstaller

## 📝 Configuration

The app uses `config.local.json` bundled with the installer:

```json
{
  "backendRepoUrl": "https://github.com/thee-pawn/whatsapp-automation.git",
  "frontendRepoUrl": "https://github.com/thee-pawn/billbook-frontend.git",
  "githubToken": "your-github-token",
  "backendPort": 4242,
  "frontendPort": 5173
}
```

## 🚀 Testing on Windows

### Option 1: Use a Windows VM
- Install Windows 10/11 in VirtualBox or Parallels
- Copy the .exe file to the VM
- Run the installer

### Option 2: Test on a Physical Windows Machine
- Copy the .exe to a Windows PC
- Run and test the full installation flow

## 📂 Installation Paths

### User Installation (Default)
```
C:\Users\{username}\AppData\Local\Programs\BillBook Application\
```

### Per-Machine Installation (Admin)
```
C:\Program Files\BillBook Application\
```

### App Data (Repositories & Logs)
```
C:\Users\{username}\AppData\Roaming\Electron\
├── repos\
│   ├── backend\
│   └── frontend\
└── logs\
    ├── backend.log
    └── frontend.log
```

## 🔧 Troubleshooting

### Build fails on macOS
```bash
# Install Wine for cross-platform building
brew install --cask wine-stable

# Or use Docker
docker pull electronuserland/builder:wine
```

### Antivirus warnings
The installer is unsigned. Users may see SmartScreen warnings:
- Click "More info" → "Run anyway"
- For production, get a code signing certificate

### Dependencies fail to install
Windows users can manually install:
- Git: https://git-scm.com/download/win
- Node.js: https://nodejs.org/

## 📊 Installer Size

- **Installer:** ~150MB
- **Installed:** ~200MB
- **Additional downloads during first run:**
  - Git: ~40MB (if not installed)
  - Node.js: ~30MB (if not installed)
  - Chromium: ~100MB
  - npm packages: ~50MB

## 🎨 Customization

To customize the installer:

1. **Change icon:** Replace `build/icon.ico`
2. **Modify installer name:** Edit `artifactName` in `package.json`
3. **Update license:** Edit `LICENSE.md`
4. **Customize NSIS:** Edit `nsis` section in `package.json`

## ✅ Pre-Release Checklist

Before distributing:

- [ ] Test on clean Windows 10 VM
- [ ] Test on clean Windows 11 VM
- [ ] Verify Git auto-installation
- [ ] Verify Node.js auto-installation
- [ ] Verify Chromium download
- [ ] Test repository cloning
- [ ] Verify backend starts on port 4242
- [ ] Verify frontend opens correctly
- [ ] Test uninstaller
- [ ] Check desktop shortcut works
- [ ] Check start menu shortcut works

## 🚢 Distribution

### For Internal Use
Upload to internal file server or shared drive

### For External Distribution
Consider:
- Code signing certificate ($100-300/year)
- Host on website or GitHub Releases
- Provide installation instructions
- Include system requirements

## 📋 System Requirements

**Minimum:**
- Windows 10 (64-bit) or later
- 4GB RAM
- 500MB free disk space (+ additional for dependencies)
- Internet connection (for first-time setup)

**Recommended:**
- Windows 11 (64-bit)
- 8GB RAM
- 1GB free disk space
- Broadband internet connection

---

## 🛠️ Advanced: Building on Windows

If building directly on Windows:

```bash
# Install Node.js
# Install Git

# Clone project
git clone <your-repo>
cd billbook-app

# Install dependencies
npm install

# Build
npm run dist:win
```

This will create both installer and portable versions in the `dist/` folder.
