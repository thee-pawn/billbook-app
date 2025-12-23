#!/usr/bin/env node
/**
 * Cross-platform script to build the frontend
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const frontendDir = path.join(__dirname, 'frontend');
const packageJsonPath = path.join(frontendDir, 'package.json');

// Debug: Show current directory and what we're looking for
console.log('Current working directory:', process.cwd());
console.log('Script directory (__dirname):', __dirname);
console.log('Looking for frontend at:', frontendDir);
console.log('Looking for package.json at:', packageJsonPath);
console.log('');

// Check if frontend directory exists
if (!fs.existsSync(frontendDir)) {
  console.error('Error: frontend directory not found at:', frontendDir);
  console.error('Please ensure you are in the project root directory.');
  console.error('\nCurrent directory contents:');
  try {
    const contents = fs.readdirSync(__dirname);
    console.error(contents.join(', '));
  } catch (e) {
    console.error('Could not read directory:', e.message);
  }
  process.exit(1);
}

// Check if package.json exists
if (!fs.existsSync(packageJsonPath)) {
  console.error('Error: frontend/package.json not found at:', packageJsonPath);
  console.error('\nFrontend directory contents:');
  try {
    const contents = fs.readdirSync(frontendDir);
    console.error(contents.join(', '));
  } catch (e) {
    console.error('Could not read frontend directory:', e.message);
  }
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

