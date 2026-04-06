# Application Icons Guide

## 📁 Icon Files Location

Place your application icons in this `build/` folder:

```
build/
├── icon.ico      # Windows icon
├── icon.icns     # macOS icon
└── icon.png      # Linux icon
```

---

## 🖼️ Icon Requirements

### Windows - `icon.ico`
- **Format:** `.ico` file
- **Size:** 256x256 pixels (recommended)
- **Must contain multiple sizes:** 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- **Color depth:** 32-bit with alpha channel

### macOS - `icon.icns`
- **Format:** `.icns` file
- **Must contain multiple sizes:**
  - 16x16 (@1x and @2x)
  - 32x32 (@1x and @2x)
  - 128x128 (@1x and @2x)
  - 256x256 (@1x and @2x)
  - 512x512 (@1x and @2x)
- **Total: 10 icon sizes in one file**

### Linux - `icon.png`
- **Format:** `.png` file
- **Size:** 512x512 pixels (or 1024x1024)
- **Transparency:** Supported (recommended)
- **Color depth:** 32-bit RGBA

---

## 🎨 Creating Icons from a Single Image

### Option 1: Online Tools (Easiest)

**For Windows (.ico):**
- https://icoconvert.com/
- Upload your PNG (512x512 or larger)
- Select "Custom sizes" and include: 16, 32, 48, 64, 128, 256
- Download as `icon.ico`

**For macOS (.icns):**
- https://cloudconvert.com/png-to-icns
- Upload your PNG (1024x1024)
- Convert to `.icns`
- Download as `icon.icns`

**For Linux (.png):**
- Just resize your image to 512x512 or 1024x1024
- Save as `icon.png`

---

### Option 2: Command Line Tools

#### For macOS (creating .icns on Mac)

1. **Prepare your source image:**
   - Create a 1024x1024 PNG file
   - Name it `icon.png`

2. **Create iconset folder:**
   ```bash
   mkdir icon.iconset
   ```

3. **Generate all required sizes:**
   ```bash
   sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
   sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
   sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
   sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
   sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
   sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
   sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
   sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
   sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
   ```

4. **Convert to .icns:**
   ```bash
   iconutil -c icns icon.iconset -o icon.icns
   ```

5. **Move to build folder:**
   ```bash
   mv icon.icns build/
   ```

---

#### For Windows (creating .ico with ImageMagick)

```bash
# Install ImageMagick first
brew install imagemagick  # macOS
sudo apt install imagemagick  # Linux

# Create multi-size .ico
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

---

#### For Linux

```bash
# Simple resize with ImageMagick
convert icon.png -resize 512x512 build/icon.png
```

---

## 🎯 Quick Setup Script

Save this as `create-icons.sh` in your project root:

```bash
#!/bin/bash

# Requires: ImageMagick and (for macOS .icns) sips/iconutil

SOURCE_PNG="source-icon.png"  # Your 1024x1024 source image

echo "🎨 Creating application icons..."

# Check if source exists
if [ ! -f "$SOURCE_PNG" ]; then
    echo "❌ Error: $SOURCE_PNG not found!"
    echo "Please create a 1024x1024 PNG image named 'source-icon.png'"
    exit 1
fi

# Create build folder
mkdir -p build

# Linux icon (simple)
echo "🐧 Creating Linux icon..."
convert "$SOURCE_PNG" -resize 512x512 build/icon.png

# Windows icon
echo "🪟 Creating Windows icon..."
convert "$SOURCE_PNG" -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# macOS icon
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Creating macOS icon..."
    
    mkdir -p icon.iconset
    sips -z 16 16     "$SOURCE_PNG" --out icon.iconset/icon_16x16.png
    sips -z 32 32     "$SOURCE_PNG" --out icon.iconset/icon_16x16@2x.png
    sips -z 32 32     "$SOURCE_PNG" --out icon.iconset/icon_32x32.png
    sips -z 64 64     "$SOURCE_PNG" --out icon.iconset/icon_32x32@2x.png
    sips -z 128 128   "$SOURCE_PNG" --out icon.iconset/icon_128x128.png
    sips -z 256 256   "$SOURCE_PNG" --out icon.iconset/icon_128x128@2x.png
    sips -z 256 256   "$SOURCE_PNG" --out icon.iconset/icon_256x256.png
    sips -z 512 512   "$SOURCE_PNG" --out icon.iconset/icon_256x256@2x.png
    sips -z 512 512   "$SOURCE_PNG" --out icon.iconset/icon_512x512.png
    sips -z 1024 1024 "$SOURCE_PNG" --out icon.iconset/icon_512x512@2x.png
    
    iconutil -c icns icon.iconset -o build/icon.icns
    rm -rf icon.iconset
else
    echo "⚠️  Skipping macOS icon (not on macOS)"
fi

echo "✅ Icons created successfully in build/ folder!"
ls -lh build/
```

Make it executable and run:
```bash
chmod +x create-icons.sh
./create-icons.sh
```

---

## 📝 Icon Design Tips

### Best Practices:
1. ✅ **Start with a large image** (1024x1024 or higher)
2. ✅ **Use simple, bold designs** - small icons need to be recognizable
3. ✅ **High contrast** - icons are often displayed on various backgrounds
4. ✅ **Center your design** - leave padding around edges
5. ✅ **Test at small sizes** - how does it look at 16x16?
6. ✅ **Use transparency** - helps icons blend with different themes

### Avoid:
- ❌ Fine details that disappear when small
- ❌ Too many colors
- ❌ Text (except maybe 1-2 letters)
- ❌ Complex gradients

---

## 🎨 Recommended Tools

### Free Design Tools:
- **Figma** (https://figma.com) - Web-based, professional
- **Inkscape** (https://inkscape.org) - Vector graphics, free
- **GIMP** (https://gimp.org) - Raster graphics, free
- **Canva** (https://canva.com) - Simple, web-based

### Icon Generators:
- **Icon Kitchen** (https://icon.kitchen/) - Android/Web icons
- **App Icon Generator** (https://appicon.co/) - iOS/Mac/Web icons
- **Real Favicon Generator** (https://realfavicongenerator.net/)

---

## 🚀 After Adding Icons

1. **Place your icons** in this `build/` folder:
   - `build/icon.ico`
   - `build/icon.icns`
   - `build/icon.png`

2. **Build your app:**
   ```bash
   npm run dist        # Current platform
   npm run dist:win    # Windows
   npm run dist:mac    # macOS
   npm run dist:linux  # Linux
   ```

3. **Verify:**
   - Check the installer has your icon
   - Check the installed app shows your icon
   - Check the taskbar/dock shows your icon

---

## 🔍 Troubleshooting

### Icons not showing after build?

1. **Check files exist:**
   ```bash
   ls -la build/
   ```

2. **Check file sizes:**
   ```bash
   file build/icon.*
   ```

3. **Clean and rebuild:**
   ```bash
   npm run clean
   rm -rf dist/
   npm run dist
   ```

4. **Verify electron-builder config** in `package.json`:
   ```json
   {
     "build": {
       "win": { "icon": "build/icon.ico" },
       "mac": { "icon": "build/icon.icns" },
       "linux": { "icon": "build/icon.png" }
     }
   }
   ```

---

## 📋 Checklist

Before building:
- [ ] Created 1024x1024 source image
- [ ] Placed `icon.ico` in `build/` (Windows)
- [ ] Placed `icon.icns` in `build/` (macOS)
- [ ] Placed `icon.png` in `build/` (Linux)
- [ ] Tested icons at different sizes
- [ ] Icons have transparency (if needed)
- [ ] Ran `npm run dist` successfully

---

## 💡 Example: BillBook+ Icon Ideas

For a billing/invoice app, consider:
- 📄 Document/invoice icon
- 💰 Money/currency symbol
- 📊 Graph/chart
- 🧾 Receipt icon
- 💳 Credit card
- "B+" monogram in a clean circle

---

Need help? Check these resources:
- Electron Builder Icons: https://www.electron.build/icons
- Icon Design Guidelines: https://developer.apple.com/design/human-interface-guidelines/app-icons
