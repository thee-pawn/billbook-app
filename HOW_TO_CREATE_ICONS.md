# How to Create Icons from Your BillBook Logo

## 📥 Step 1: Save Your Logo Image

Save your BillBook logo as: `billbook-source.png` in this folder.

```
/Users/pawankumar/billbook-app/billbook-source.png
```

---

## ⚡ Quick Method: Use the Script (30 seconds!)

I've created an automated script for you!

```bash
# Run this in your terminal:
./create-icons.sh
```

The script will automatically create all three icon formats!

### If you get errors:

**Missing ImageMagick?** Install it:
```bash
brew install imagemagick
```

---

## 🌐 Alternative: Online Tools (No installation needed!)

If the script doesn't work, use these online tools:

### 1. Windows Icon (.ico)
- Go to: https://icoconvert.com/
- Upload `billbook-source.png`
- Check sizes: 16, 32, 48, 64, 128, 256
- Download as `icon.ico`
- Move to: `build/icon.ico`

### 2. macOS Icon (.icns)
- Go to: https://cloudconvert.com/png-to-icns
- Upload `billbook-source.png`
- Convert and download as `icon.icns`
- Move to: `build/icon.icns`

### 3. Linux Icon (.png)
- Go to: https://www.iloveimg.com/resize-image
- Upload `billbook-source.png`
- Resize to: 512 x 512 pixels
- Download as `icon.png`
- Move to: `build/icon.png`

---

## ✅ After Creating Icons

1. **Verify icons exist:**
   ```bash
   ls -la build/
   ```
   
   You should see:
   ```
   build/icon.ico   (Windows)
   build/icon.icns  (macOS)
   build/icon.png   (Linux)
   ```

2. **Build your app:**
   ```bash
   npm run dist        # Current platform
   npm run dist:mac    # macOS DMG
   npm run dist:win    # Windows installer
   npm run dist:linux  # Linux AppImage
   ```

3. **Check the installer** - your BillBook logo should appear!

---

## 🎨 Your Logo

The beautiful BillBook logo with:
- Teal book icon on the left
- "BB" text on the right
- Professional gradient colors

Will look great as your app icon! 🚀
