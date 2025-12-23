const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Determine Playwright cache directory based on platform
function getPlaywrightCacheDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
  } else {
    // On macOS, Playwright uses ~/Library/Caches/ms-playwright by default
    if (process.platform === 'darwin') {
      const macCache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
      if (fs.existsSync(macCache)) {
        return macCache;
      }
      // Fallback to ~/.cache/ms-playwright if Library/Caches doesn't exist
    }
    return path.join(os.homedir(), '.cache', 'ms-playwright');
  }
}

// Copy directory recursively (cross-platform)
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`Source directory does not exist: ${src}`);
    return false;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  try {
    if (process.platform === 'win32') {
      // Use robocopy on Windows (more reliable than xcopy)
      execSync(`robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS`, { stdio: 'inherit' });
    } else {
      // Use cp on Unix-like systems
      execSync(`cp -r "${src}"/* "${dest}"/`, { stdio: 'inherit' });
    }
    console.log(`Successfully copied Playwright browsers from ${src} to ${dest}`);
    return true;
  } catch (error) {
    console.log(`Could not copy browsers: ${error.message}`);
    console.log('Browsers will be installed on first run of the app');
    return false;
  }
}

const cacheDir = getPlaywrightCacheDir();
const targetDir = path.join(__dirname, 'playwright-browsers');

console.log(`Looking for Playwright browsers in: ${cacheDir}`);

if (fs.existsSync(cacheDir)) {
  console.log('Found Playwright cache, copying browsers...');
  const success = copyDir(cacheDir, targetDir);
  
  if (success) {
    // Verify the copy was successful
    console.log('\nVerifying copied browsers...');
    if (fs.existsSync(targetDir)) {
      const entries = fs.readdirSync(targetDir);
      console.log(`Found ${entries.length} browser directories:`, entries);
      
      // Check for Chromium specifically
      const chromiumDirs = entries.filter(e => e.startsWith('chromium'));
      if (chromiumDirs.length > 0) {
        console.log('✓ Chromium browsers found:', chromiumDirs);
        
        // Verify structure - check if we can find an executable
        let foundExecutable = false;
        for (const dir of chromiumDirs) {
          const chromiumDir = path.join(targetDir, dir);
          try {
            // Check for Windows structure (since we're building for Windows)
            const winExe = path.join(chromiumDir, 'chrome-win', 'chrome.exe');
            const winHeadless = path.join(chromiumDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
            
            if (fs.existsSync(winExe) || fs.existsSync(winHeadless)) {
              foundExecutable = true;
              console.log(`✓ Found Windows Chromium executable in ${dir}`);
              break;
            }
            
            // Also check macOS structure (in case we're building on Mac)
            const macExe = path.join(chromiumDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
            if (fs.existsSync(macExe)) {
              console.log(`⚠ Found macOS Chromium executable in ${dir} (will not work on Windows)`);
            }
          } catch (err) {
            // Continue checking other directories
          }
        }
        
        if (!foundExecutable) {
          console.log('⚠ Warning: Chromium directories found but no Windows executables detected');
          console.log('  Note: Building on macOS will copy macOS browsers, which won\'t work on Windows');
          console.log('  The app will attempt to download Windows browsers on first run.');
        }
      } else {
        console.log('⚠ Warning: No Chromium browsers found in copied directory');
      }
    } else {
      console.log('✗ Error: Target directory was not created');
      process.exit(1);
    }
  } else {
    console.log('✗ Failed to copy browsers');
    process.exit(1);
  }
} else {
  console.log('✗ Playwright cache not found.');
  console.log('Please run: cd backend && npx playwright install chromium');
  process.exit(1);
}

