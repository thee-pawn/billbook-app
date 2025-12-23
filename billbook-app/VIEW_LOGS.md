# How to View Logs in Electron App

There are several ways to view logs from the Electron application:

## 1. Development Mode (Terminal)

When running in development mode (`npm run dev`), all logs appear in the terminal where you started the app.

```bash
npm run dev
```

You'll see logs like:
```
[Backend] WhatsApp Direct Service started on port 4242
Loading frontend from: /path/to/frontend/dist/index.html
Frontend finished loading
```

## 2. Electron DevTools Console

### In Development Mode:
DevTools automatically open when you run `npm run dev`.

### In Production/Packaged App:
Press **F12** (or **Cmd+Option+I** on Mac, **Ctrl+Shift+I** on Windows/Linux) to toggle DevTools.

The DevTools Console shows:
- Frontend JavaScript errors
- Backend logs (if sent to renderer process)
- Network requests
- React DevTools (if installed)

**Note:** The DevTools Console shows frontend logs. Backend logs from the main process are not directly visible here.

## 3. Log File (Production Only)

In packaged/production builds, logs are automatically saved to a file:

**macOS:**
```
~/Library/Logs/billbook-app/main.log
```

**Windows:**
```
%APPDATA%\billbook-app\logs\main.log
```

**Linux:**
```
~/.config/billbook-app/logs/main.log
```

To view the log file:

### macOS:
```bash
tail -f ~/Library/Logs/billbook-app/main.log
```

### Windows (PowerShell):
```powershell
Get-Content $env:APPDATA\billbook-app\logs\main.log -Wait
```

### Linux:
```bash
tail -f ~/.config/billbook-app/logs/main.log
```

## 4. System Console (macOS)

On macOS, you can also view logs in the Console app:

1. Open **Console.app** (Applications > Utilities > Console)
2. Search for "billbook" or "Electron"
3. Filter by your app name

## 5. Backend Logs

The backend process logs are captured by the main Electron process and written to:
- Console output (development)
- Log file (production)
- Backend also has its own log files in the backend directory (if Winston logging is configured)

Backend log files location (relative to backend directory):
- `error.log` - Error level logs
- `combined.log` - All logs

## Quick Tips

1. **To see backend startup logs immediately:**
   - Check the terminal (development)
   - Check the log file (production)
   - Look for messages like "WhatsApp Direct Service started on port 4242"

2. **To debug frontend issues:**
   - Press F12 to open DevTools
   - Check the Console tab for errors
   - Check the Network tab for API requests

3. **To debug backend issues:**
   - Check the log file location above
   - Check backend's own log files in the backend directory
   - Look for `[Backend Error]` messages in the logs

## 6. Electron/Chromium Debug Logs

Electron and Chromium generate their own debug logs that may contain errors not visible in the main application logs. These are particularly useful for diagnosing low-level issues.

### Windows Debug Log Location

On Windows, Electron/Chromium debug logs are typically written to:

**Windows:**
```
%LOCALAPPDATA%\BillBook\debug.log
```

Or in the application directory:
```
<Installation Directory>\BillBook\debug.log
```

To view the debug log on Windows (PowerShell):
```powershell
Get-Content "$env:LOCALAPPDATA\BillBook\debug.log" -Wait
```

Or check the installation directory:
```powershell
Get-Content "C:\Users\<YourUsername>\AppData\Local\Programs\BillBook\debug.log" -Wait
```

### Common Debug Log Errors

#### ICU Data Error

If you see an error like:
```
[1223/173954.520:ERROR:base\i18n\icu_util.cc:223] Invalid file descriptor to ICU data received.
```

This indicates an issue with the International Components for Unicode (ICU) data file (`icudtl.dat`). This error is usually:

1. **Non-critical**: The app may still function, but some internationalization features might not work correctly
2. **Caused by**: Missing, corrupted, or inaccessible `icudtl.dat` file
3. **Location**: The `icudtl.dat` file should be in the same directory as the Electron executable

**To verify the file exists:**
- Check the installation directory for `icudtl.dat`
- It should be alongside `BillBook.exe` (or the main executable)

**If the error persists:**
- Reinstall the application to restore the ICU data file
- Check if antivirus software is blocking access to the file
- Verify file permissions allow the application to read the file

### Enabling Verbose Debug Logging

To capture more detailed debug information, you can enable verbose logging by:

1. **Creating a shortcut** with the following flags:
   ```
   --enable-logging --log-level=0
   ```

2. **Or running from command line:**
   ```bash
   BillBook.exe --enable-logging --log-level=0
   ```

This will generate more detailed logs in the debug.log file.

## Log Levels

- **INFO**: Normal operation messages
- **ERROR**: Error messages (prefixed with `ERROR:`)
- **Backend logs**: Prefixed with `[Backend]` or `[Backend Error]`

