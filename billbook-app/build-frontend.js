#!/usr/bin/env node
/**
 * Cross-platform script to build the frontend
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const frontendDir = path.join(__dirname, 'frontend');
const packageJsonPath = path.join(frontendDir, 'package.json');

// Check if frontend directory exists
if (!fs.existsSync(frontendDir)) {
  console.error('Error: frontend directory not found at:', frontendDir);
  console.error('Please ensure you are in the project root directory.');
  process.exit(1);
}

// Check if package.json exists
if (!fs.existsSync(packageJsonPath)) {
  console.error('Error: frontend/package.json not found at:', packageJsonPath);
  process.exit(1);
}

console.log('Building frontend...');
console.log('Frontend directory:', frontendDir);
console.log('');

try {
  // Install dependencies
  console.log('Installing frontend dependencies...');
  execSync('npm install', {
    cwd: frontendDir,
    stdio: 'inherit'
  });
  
  // Build
  console.log('\nBuilding frontend...');
  execSync('npm run build', {
    cwd: frontendDir,
    stdio: 'inherit'
  });
  
  console.log('\n✓ Frontend build completed successfully!');
} catch (error) {
  console.error('\n✗ Frontend build failed');
  process.exit(1);
}

