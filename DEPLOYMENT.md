# Deployment Guide

## Overview

This guide covers how to build and distribute your Electron application to end users.

## Pre-Deployment Checklist

### 1. Update Configuration

Edit `src/electron/src/config.ts` with production values:

```typescript
const defaultConfig: AppConfig = {
  backendRepoUrl: "https://github.com/YOUR-ORG/backend.git",
  frontendRepoUrl: "https://github.com/YOUR-ORG/frontend.git",
  backendStartCommand: "npm run start",
  frontendBuildCommand: "npm run build",
  frontendStartCommand: "npm run start",
  appName: "Your App Name",
  appId: "com.yourcompany.yourapp",
  backendPort: 3001,
  frontendPort: 3000,
  initialBranch: "main",
};
```

### 2. Update package.json

```json
{
  "name": "your-app-name",
  "version": "1.0.0",
  "description": "Your app description",
  "author": "Your Company",
  "build": {
    "appId": "com.yourcompany.yourapp",
    "productName": "Your App Name"
  }
}
```

### 3. Create Application Icons

You need icons for each platform:

**Windows** - `build/icon.ico`
- Size: 256x256 pixels
- Format: .ico file
- Tool: Use online converters or Photoshop

**macOS** - `build/icon.icns`
- Multiple sizes: 16x16, 32x32, 128x128, 256x256, 512x512, 1024x1024
- Format: .icns file
- Tool: Use `png2icns` or Icon Composer

**Linux** - `build/icon.png`
- Size: 512x512 pixels
- Format: .png file

#### Quick Icon Generation

```bash
# Create build directory
mkdir -p build

# Place your 1024x1024 PNG as source
# Use ImageMagick to generate icons:

# Windows
convert icon.png -resize 256x256 build/icon.ico

# macOS (requires png2icns)
png2icns build/icon.icns icon.png

# Linux
convert icon.png -resize 512x512 build/icon.png
```

### 4. Test Locally

```bash
npm run dev
```

Verify:
- ✅ Initialization completes successfully
- ✅ Repositories clone correctly
- ✅ Services start without errors
- ✅ Main window loads the frontend
- ✅ No console errors

---

## Building Installers

### Prerequisites

Install platform-specific build tools:

**Windows (from Windows machine):**
```bash
# No additional tools needed
npm install
```

**macOS (from macOS machine):**
```bash
# Xcode Command Line Tools
xcode-select --install
```

**Linux (from Linux machine):**
```bash
# Ubuntu/Debian
sudo apt-get install -y rpm

# Fedora
sudo dnf install rpm-build
```

### Build Commands

#### Build for Current Platform

```bash
npm run dist
```

This creates installer for your current OS.

#### Build for Specific Platform

```bash
# Windows (must run on Windows or use CI/CD)
npm run dist:win

# macOS (must run on macOS or use CI/CD)
npm run dist:mac

# Linux (can run on Linux or macOS)
npm run dist:linux
```

#### Build for All Platforms

```bash
# This only works with electron-builder's paid cloud service
# or appropriate CI/CD setup
npm run dist -- --win --mac --linux
```

### Output

Installers are created in the `dist/` folder:

```
dist/
├── BillBook Application Setup 1.0.0.exe       # Windows
├── BillBook Application-1.0.0.dmg             # macOS
├── BillBook Application-1.0.0.AppImage        # Linux
└── latest.yml / latest-mac.yml / latest-linux.yml  # Auto-update info
```

---

## Platform-Specific Notes

### Windows

**Installer Type:** NSIS (Nullsoft Scriptable Install System)

**User Experience:**
1. User downloads `.exe` file
2. Runs installer (may see Windows Defender warning for unsigned apps)
3. Chooses installation directory
4. Desktop shortcut created
5. Starts menu entry added

**Signing (Recommended):**
- Get a code signing certificate (Digicert, Sectigo, etc.)
- Cost: $200-$500/year
- Prevents "Unknown Publisher" warnings
- Configure in `package.json`:

```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/cert.pfx",
      "certificatePassword": "password"
    }
  }
}
```

### macOS

**Installer Type:** DMG (Disk Image)

**User Experience:**
1. User downloads `.dmg` file
2. Opens DMG
3. Drags app to Applications folder
4. Ejects DMG
5. Opens app from Applications

**Notarization (Required for macOS 10.15+):**
- Need Apple Developer account ($99/year)
- Sign app with Developer ID certificate
- Notarize with Apple
- Configure in `package.json`:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

**For Development (unsigned):**
Users need to:
1. Right-click app
2. Click "Open"
3. Click "Open" in dialog

### Linux

**Installer Type:** AppImage (portable)

**User Experience:**
1. User downloads `.AppImage` file
2. Makes it executable: `chmod +x app.AppImage`
3. Runs: `./app.AppImage`
4. No installation needed (portable)

**Alternative Formats:**
- `.deb` for Debian/Ubuntu
- `.rpm` for Fedora/Red Hat
- Snap package
- Flatpak

Configure in `package.json`:
```json
{
  "build": {
    "linux": {
      "target": ["AppImage", "deb", "rpm"]
    }
  }
}
```

---

## Code Signing

### Why Sign?

**Benefits:**
- ✅ Removes "Unknown Publisher" warnings
- ✅ Users trust the application
- ✅ Required for macOS 10.15+ without workarounds
- ✅ Better for enterprise deployment

**Drawbacks:**
- ❌ Costs money ($99-$500/year)
- ❌ Additional setup required
- ❌ Renewal needed annually

### Windows Code Signing

1. **Get Certificate**
   - Purchase from Digicert, Sectigo, etc.
   - Requires business verification
   - Delivered as .pfx file

2. **Configure**
   ```json
   {
     "build": {
       "win": {
         "certificateFile": "certs/windows.pfx",
         "certificatePassword": "your-password",
         "signingHashAlgorithms": ["sha256"]
       }
     }
   }
   ```

3. **Build**
   ```bash
   npm run dist:win
   ```

### macOS Code Signing & Notarization

1. **Join Apple Developer Program** ($99/year)

2. **Create Certificates** (in Xcode)
   - Developer ID Application
   - Developer ID Installer

3. **Create Notarization Script**
   
   `scripts/notarize.js`:
   ```javascript
   const { notarize } = require('electron-notarize');
   
   exports.default = async function notarizing(context) {
     const { electronPlatformName, appOutDir } = context;
     if (electronPlatformName !== 'darwin') return;
     
     const appName = context.packager.appInfo.productFilename;
     
     return await notarize({
       appBundleId: 'com.yourcompany.yourapp',
       appPath: `${appOutDir}/${appName}.app`,
       appleId: process.env.APPLE_ID,
       appleIdPassword: process.env.APPLE_ID_PASSWORD,
     });
   };
   ```

4. **Set Environment Variables**
   ```bash
   export APPLE_ID="your@email.com"
   export APPLE_ID_PASSWORD="app-specific-password"
   ```

5. **Build**
   ```bash
   npm run dist:mac
   ```

---

## Auto-Updates

electron-builder includes auto-update support.

### Setup

1. **Host Update Files**
   - GitHub Releases (free)
   - S3/CloudFront
   - Your own server

2. **Update package.json**
   ```json
   {
     "build": {
       "publish": {
         "provider": "github",
         "owner": "your-username",
         "repo": "your-repo"
       }
     }
   }
   ```

3. **Add Update Code** (in `main.ts`)
   ```typescript
   import { autoUpdater } from 'electron-updater';
   
   autoUpdater.checkForUpdatesAndNotify();
   ```

4. **Publish Release**
   ```bash
   # Build and publish to GitHub
   GH_TOKEN=your_token npm run dist -- --publish always
   ```

---

## CI/CD Deployment

### GitHub Actions

`.github/workflows/build.yml`:

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      
      - run: npm install
      
      - run: npm run dist
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - uses: actions/upload-artifact@v3
        with:
          name: ${{ matrix.os }}
          path: dist/*
```

---

## Distribution Checklist

Before releasing:

- [ ] Update version in `package.json`
- [ ] Test on clean machine
- [ ] Update `README.md` with instructions
- [ ] Create release notes
- [ ] Generate all platform installers
- [ ] Test each installer
- [ ] Sign applications (if applicable)
- [ ] Upload to distribution platform
- [ ] Create download links
- [ ] Notify users

---

## Support & Maintenance

### User Support

Provide users with:
1. **Installation guide** (how to install)
2. **Configuration guide** (GitHub token setup)
3. **Troubleshooting guide** (common issues)
4. **FAQ** (frequent questions)
5. **Contact information** (support email)

### Updating

When releasing updates:
1. Increment version in `package.json`
2. Update `CHANGELOG.md`
3. Rebuild installers
4. Test thoroughly
5. Upload to distribution
6. Notify users (if no auto-update)

---

## Distribution Platforms

### Self-Hosting

**Pros:**
- Full control
- No fees
- Direct download links

**Cons:**
- Need hosting
- Manage bandwidth
- Handle updates manually

**Where:**
- Your website
- GitHub Releases (free)
- S3 + CloudFront

### App Stores

#### Microsoft Store (Windows)

**Pros:**
- Built-in to Windows
- User trust
- Auto-updates

**Cons:**
- $19 registration
- Review process
- Must follow guidelines

#### Mac App Store

**Pros:**
- Best distribution on macOS
- User trust
- Auto-updates

**Cons:**
- $99/year Developer Program
- Strict review process
- Sandboxing requirements (may break Git/Node installation)

**Not Recommended** for this app due to sandboxing restrictions.

#### Snap Store / Flathub (Linux)

**Pros:**
- Free
- Easy installation
- Auto-updates

**Cons:**
- Limited distribution
- Sandboxing may cause issues

---

## Best Practices

1. **Version Your Releases**
   - Use semantic versioning (1.0.0, 1.1.0, 2.0.0)
   - Tag commits: `git tag v1.0.0`

2. **Maintain a Changelog**
   - Document all changes
   - Help users understand what's new

3. **Test Thoroughly**
   - Test on clean machines
   - Test all platforms
   - Test first-run experience

4. **Provide Documentation**
   - Installation guide
   - Configuration guide
   - Troubleshooting guide

5. **Monitor Issues**
   - Collect user feedback
   - Fix bugs promptly
   - Release updates regularly

6. **Communicate Clearly**
   - Clear error messages
   - Helpful UI feedback
   - Good documentation

---

## Troubleshooting Build Issues

### "Cannot find module 'electron'"

```bash
cd src/electron
npm install
cd ../..
npm install
```

### "Code signing failed"

- Check certificate is valid
- Verify password is correct
- Ensure certificate isn't expired

### "DMG creation failed"

- macOS only: Ensure running on macOS
- Check disk space
- Try: `rm -rf dist && npm run dist:mac`

### "NSIS error"

- Windows only
- Check icon file exists at `build/icon.ico`
- Verify file paths in config

---

## Cost Breakdown

**Free Options:**
- ✅ Self-hosting (GitHub Releases)
- ✅ Unsigned apps (users see warning)
- ✅ Manual distribution

**Paid Options:**
- Windows Code Signing: $200-500/year
- Apple Developer Program: $99/year
- Microsoft Store: $19 one-time
- Domain for downloads: $10-15/year

**Recommended Starting Point:**
- Start with GitHub Releases (free)
- Add signing later as you grow
- Focus on product first

---

## Next Steps

1. Configure your repositories in `config.ts`
2. Test the build process
3. Create application icons
4. Build installers for your platform
5. Test on clean machine
6. Distribute to users
7. Gather feedback
8. Iterate and improve

Good luck with your deployment! 🚀
