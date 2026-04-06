# Checking why the Windows app didn’t pull the latest code

If the app doesn’t pull the latest code on Windows, use the **update check log file** to see what happened.

## 1. Where is the log file?

On Windows the log is here:

```
%APPDATA%\BillBook Application\logs\update-check.log
```

Typical full path:

```
C:\Users\<YourUsername>\AppData\Roaming\BillBook Application\logs\update-check.log
```

- Press **Win + R**, type `%APPDATA%\BillBook Application\logs` and press Enter to open the folder.
- Open `update-check.log` in Notepad or any text editor.

## 2. What to look for in the log

- **`Update check scheduled in 5000ms (platform: win32)`**  
  The background update check was scheduled.

- **`Checking for updates (git pull + npm install)...`**  
  The check started.

- **`No updates (already up to date).`**  
  No new commits; nothing to pull.

- **`No new code pulled. Error (non-fatal): ...`**  
  The update check ran but failed (e.g. git not found, network, or path issue). The message after `ERROR:` explains the cause.

- **`Background update check failed. ERROR: ...`**  
  The update check threw an exception; the rest of the line (and optional stack) is the error.

- **`Updates applied; user will be prompted to restart.`**  
  New code was pulled and the app asked you to restart.

## 3. If the log file is missing

- Run the app at least once and wait **at least 5–6 seconds** after the main window appears (the check runs after 5 seconds).
- If you installed via the **x64** installer, the app name in the path is usually `BillBook Application`. If your app name is different, look under `%APPDATA%\<YourAppName>\logs\`.

## 4. Run from Command Prompt to see console output (optional)

You can also see update messages in the console:

1. Open **Command Prompt** (cmd).
2. Run the app from its install folder, for example:
   ```bat
   "C:\Users\<You>\AppData\Local\Programs\billbook-app\BillBook Application.exe"
   ```
3. Watch the window for lines like `[V2] Background: update check scheduled...` and any errors.

The log file is still the most reliable way to debug, since it persists and is written even when no console is visible.
