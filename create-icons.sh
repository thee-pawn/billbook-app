#!/bin/bash

# BillBook Icon Generator Script
# Place your source image as 'billbook-source.png' in the same folder as this script

SOURCE_PNG="billbook-source.png"

echo "🎨 BillBook Icon Generator"
echo "=========================="

# Check if source exists
if [ ! -f "$SOURCE_PNG" ]; then
    echo "❌ Error: $SOURCE_PNG not found!"
    echo ""
    echo "Please save your BillBook logo as 'billbook-source.png' in this folder"
    echo "Then run this script again: ./create-icons.sh"
    exit 1
fi

# Create build folder
mkdir -p build

echo ""
echo "📦 Creating icons..."

# 1. Linux icon (simple resize)
echo "  → Linux icon (512x512)..."
if command -v sips &> /dev/null; then
    sips -z 512 512 "$SOURCE_PNG" --out build/icon.png 2>/dev/null
    echo "  ✅ build/icon.png created"
elif command -v convert &> /dev/null; then
    convert "$SOURCE_PNG" -resize 512x512 build/icon.png
    echo "  ✅ build/icon.png created"
else
    echo "  ⚠️  Install ImageMagick: brew install imagemagick"
fi

# 2. macOS icon (.icns)
echo "  → macOS icon (.icns)..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Create iconset folder
    mkdir -p icon.iconset
    
    # Generate all required sizes
    sips -z 16 16     "$SOURCE_PNG" --out icon.iconset/icon_16x16.png 2>/dev/null
    sips -z 32 32     "$SOURCE_PNG" --out icon.iconset/icon_16x16@2x.png 2>/dev/null
    sips -z 32 32     "$SOURCE_PNG" --out icon.iconset/icon_32x32.png 2>/dev/null
    sips -z 64 64     "$SOURCE_PNG" --out icon.iconset/icon_32x32@2x.png 2>/dev/null
    sips -z 128 128   "$SOURCE_PNG" --out icon.iconset/icon_128x128.png 2>/dev/null
    sips -z 256 256   "$SOURCE_PNG" --out icon.iconset/icon_128x128@2x.png 2>/dev/null
    sips -z 256 256   "$SOURCE_PNG" --out icon.iconset/icon_256x256.png 2>/dev/null
    sips -z 512 512   "$SOURCE_PNG" --out icon.iconset/icon_256x256@2x.png 2>/dev/null
    sips -z 512 512   "$SOURCE_PNG" --out icon.iconset/icon_512x512.png 2>/dev/null
    sips -z 1024 1024 "$SOURCE_PNG" --out icon.iconset/icon_512x512@2x.png 2>/dev/null
    
    # Convert to .icns
    iconutil -c icns icon.iconset -o build/icon.icns
    
    # Cleanup
    rm -rf icon.iconset
    echo "  ✅ build/icon.icns created"
else
    echo "  ⚠️  macOS icon (.icns) requires macOS"
fi

# 3. Windows icon (.ico)
echo "  → Windows icon (.ico)..."
if command -v convert &> /dev/null; then
    convert "$SOURCE_PNG" -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico 2>/dev/null
    echo "  ✅ build/icon.ico created"
else
    echo "  ⚠️  Install ImageMagick: brew install imagemagick"
    echo "     Or use online tool: https://icoconvert.com/"
fi

echo ""
echo "✅ Icon generation complete!"
echo ""
echo "📁 Files created in build/ folder:"
ls -lh build/icon.* 2>/dev/null || echo "  (Check for any errors above)"

echo ""
echo "🚀 Next steps:"
echo "  1. Check the icons: ls -la build/"
echo "  2. Build your app: npm run dist"
echo ""
