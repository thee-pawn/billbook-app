# Diagnostic Steps for Frontend Loading Issue

Follow these steps **in order** to collect diagnostic information. Copy the output from each step.

## Step 1: Check if Frontend Dist Exists Before Build

**On your Mac (before building):**

```bash
# Navigate to project root
cd /Users/pawankumar/projects/billbook/billbook-app

# Check if frontend/dist exists and has content
ls -la frontend/dist/
ls -la frontend/dist/index.html
ls -la frontend/dist/assets/ | head -20
```

**Copy the output here:**
```
[Paste output here]
```

---

## Step 2: Verify Build Process

**On your Mac (during build):**

```bash
# Run the build and capture output
npm run build:win 2>&1 | tee build-output.log
```

**After build completes, check:**
```bash
# Check if frontend/dist still exists
ls -la frontend/dist/index.html

# Check what was created in dist-electron
ls -la dist-electron/
ls -la dist-electron/win-unpacked/ 2>/dev/null || echo "win-unpacked not found"
```

**Copy the output here:**
```
[Paste output here]
```

---

## Step 3: Check Installed Application Files (Windows)

**On Windows (after installing the new build):**

Open PowerShell **as Administrator** and run:

```powershell
# Navigate to installation directory
cd "C:\Users\pawankumar\AppData\Local\Programs\BillBook"

# Check if resources folder exists
Test-Path "resources"
Get-ChildItem "resources" -ErrorAction SilentlyContinue | Select-Object Name, Mode

# Check if frontend folder exists in resources
Test-Path "resources\frontend"
Get-ChildItem "resources\frontend" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Mode

# Specifically check for index.html
Test-Path "resources\frontend\dist\index.html"
Get-Item "resources\frontend\dist\index.html" -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime

# List all files in frontend/dist
Get-ChildItem "resources\frontend\dist" -Recurse -ErrorAction SilentlyContinue | Format-Table FullName, Length -AutoSize
```

**Copy the FULL output here:**
```
[Paste output here]
```

---

## Step 4: Check Application Logs (Windows)

**On Windows:**

```powershell
# Check if log file exists
$logPath = "$env:APPDATA\billbook-app\logs\main.log"
Test-Path $logPath

# If it exists, get the last 50 lines
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 50
} else {
    Write-Host "Log file not found at: $logPath"
}

# Also check for any error logs
Get-ChildItem "$env:APPDATA\billbook-app" -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "`n=== $($_.FullName) ==="
    Get-Content $_.FullName -Tail 20
}
```

**Copy the FULL output here:**
```
[Paste output here]
```

---

## Step 5: Check Electron Resources Path (Windows)

**On Windows, run the app with logging and capture output:**

```powershell
# Run the app with verbose logging
cd "C:\Users\pawankumar\AppData\Local\Programs\BillBook"
.\BillBook.exe --enable-logging --log-level=0 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\billbook-output.txt"
```

**Wait 10 seconds, then press Ctrl+C to stop it.**

**Then check the output file:**
```powershell
Get-Content "$env:USERPROFILE\Desktop\billbook-output.txt"
```

**Copy the output here:**
```
[Paste output here]
```

---

## Step 6: Manual File Check (Windows)

**On Windows, manually verify the file structure:**

```powershell
# Create a detailed directory tree
$basePath = "C:\Users\pawankumar\AppData\Local\Programs\BillBook"
Write-Host "=== Checking $basePath ===" -ForegroundColor Cyan

# Check main directory
Write-Host "`nMain directory:" -ForegroundColor Yellow
Get-ChildItem $basePath | Select-Object Name, Mode, @{Name="Type";Expression={if($_.PSIsContainer){"Directory"}else{"File"}}}

# Check resources
Write-Host "`nResources directory:" -ForegroundColor Yellow
$resourcesPath = Join-Path $basePath "resources"
if (Test-Path $resourcesPath) {
    Get-ChildItem $resourcesPath -Recurse | Select-Object FullName, @{Name="Type";Expression={if($_.PSIsContainer){"Directory"}else{"File"}}}, Length | Format-Table -AutoSize
} else {
    Write-Host "Resources folder does not exist!" -ForegroundColor Red
}

# Specifically check frontend
Write-Host "`nFrontend path check:" -ForegroundColor Yellow
$frontendPath = Join-Path $resourcesPath "frontend\dist\index.html"
Write-Host "Expected path: $frontendPath"
Write-Host "Exists: $(Test-Path $frontendPath)"
if (Test-Path $frontendPath) {
    $file = Get-Item $frontendPath
    Write-Host "Size: $($file.Length) bytes"
    Write-Host "Last modified: $($file.LastWriteTime)"
}
```

**Copy the FULL output here:**
```
[Paste output here]
```

---

## Step 7: Check Build Configuration

**On your Mac, verify the package.json configuration:**

```bash
cd /Users/pawankumar/projects/billbook/billbook-app

# Show the relevant build config
cat package.json | grep -A 30 '"build"'
```

**Copy the output here:**
```
[Paste output here]
```

---

## What to Provide

Please provide the output from **ALL 7 steps** above. This will help identify:

1. ✅ Whether frontend/dist exists before build
2. ✅ Whether build process completes successfully  
3. ✅ What files actually exist in the installed app
4. ✅ What the application logs show
5. ✅ What Electron sees at runtime
6. ✅ The exact file structure on Windows
7. ✅ The build configuration

**Once you provide all this information, I can pinpoint the exact issue and provide a targeted fix.**

