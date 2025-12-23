# Fix for node_modules Not Being Included

The issue is that electron-builder is not including `node_modules` in the packaged app, even though they're specified in `extraResources`.

## Root Cause
Electron-builder may be respecting `.gitignore` files by default, which excludes `node_modules` directories.

## Solution Options

### Option 1: Copy node_modules to a temporary directory (RECOMMENDED)
Create a build script that copies node_modules to a temporary location that's not gitignored:

1. Update `prepare-backend-dist` script:
```json
"prepare-backend-dist": "cd backend && npm install && npm run build && npm install --omit=dev && cp -r node_modules ../backend-node_modules-temp"
```

2. Update `extraResources`:
```json
"extraResources": [
  {
    "from": "backend/dist",
    "to": "backend/dist"
  },
  {
    "from": "backend-node_modules-temp",
    "to": "backend/node_modules"
  },
  {
    "from": "backend/package.json",
    "to": "backend/package.json"
  }
]
```

### Option 2: Use electron-builder's asarUnpack
Try unpacking node_modules from asar:

```json
"asarUnpack": [
  "**/backend/node_modules/**/*"
]
```

### Option 3: Bundle backend with pkg
Use `pkg` to create a single executable for the backend, which bundles all dependencies.

### Option 4: Copy node_modules manually after build
Add a post-build script that manually copies node_modules to the packaged app location.


