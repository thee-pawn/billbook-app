# Playwright Browser Fix Guide

## Issue
Playwright browsers are not being found in the packaged Electron app, causing the error:
```
browserType.launch: Executable doesn't exist at C:\Users\...\ms-playwright\chromium_headless_shell-1200\...
```

## Solution Steps

### 1. Verify Browsers Are Copied During Build

After running `npm run build:win`, check if browsers were copied:

**On Mac (after build):**
```bash
ls -la playwright-browsers/
```

You should see directories like:
- `chromium-XXXX` or `chromium_headless_shell-XXXX`

### 2. Verify Browsers Are in Installed App

**On Windows (after installing the app):**

Open PowerShell and run:
```powershell
$browsersPath = "C:\Users\pawankumar\AppData\Local\Programs\BillBook\resources\playwright-browsers"
Test-Path $browsersPath
Get-ChildItem $browsersPath -ErrorAction SilentlyContinue | Select-Object Name
```

**Expected output:**
- Should return `True` for `Test-Path`
- Should list browser directories like `chromium-XXXX` or `chromium_headless_shell-XXXX`

### 3. Check Backend Logs

When the backend tries to launch the browser, check the logs at:
```
%APPDATA%\billbook-app\logs\main.log
```

Look for lines like:
- `Checking for bundled browsers`
- `Found Chromium executable`
- `Using bundled Chromium executable`

### 4. If Browsers Are Missing

If browsers are not in the installed app:

1. **On Mac, before building:**
   ```bash
   # Make sure browsers are installed
   cd backend
   npx playwright install chromium
   cd ..
   
   # Verify they exist
   ls ~/.cache/ms-playwright/  # Linux/Mac
   # or
   ls ~/Library/Caches/ms-playwright/  # macOS alternative
   ```

2. **Rebuild:**
   ```bash
   npm run build:win
   ```

3. **Check the build output** - you should see:
   ```
   Found Playwright cache, copying browsers...
   ✓ Chromium browsers found: [chromium-XXXX]
   ```

### 5. Manual Browser Installation (Fallback)

If bundling doesn't work, you can install browsers on the target Windows machine:

**On Windows (where the app is installed):**
```powershell
# Navigate to backend directory in installed app
cd "C:\Users\pawankumar\AppData\Local\Programs\BillBook\resources\backend"

# Install Playwright browsers
npx playwright install chromium
```

This will install browsers to the user's local Playwright cache, which the app can use as a fallback.

## Debugging

If the issue persists, check:

1. **Backend logs** - Look for browser initialization errors
2. **Browser path** - Verify the executable path in logs
3. **File permissions** - Ensure the app can read the browser files
4. **Antivirus** - Some antivirus software blocks browser executables

## Next Steps

After rebuilding with the updated code:
1. The backend will have better logging
2. It will throw a clear error if browsers aren't found
3. It will list what browser directories are available

Check the logs to see exactly what's happening.

