#!/usr/bin/env node
// Runs before every build (see package.json's "build" script). The MediaPipe wasm/ folder in
// public/libs/mediapipe/wasm is a byte-for-byte copy of node_modules/@mediapipe/tasks-vision's
// own wasm/ folder, self-hosted per FilesetResolver's requirement that these files "be published
// without renaming" (see docs/virtual-background.md). If someone bumps the @mediapipe/tasks-vision
// dependency version without re-copying, the app would silently load an OLD wasm runtime against
// a NEW package version -- this catches that mismatch at build time instead of at runtime in
// someone's browser.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PINNED_VERSION = '1.0.1';
const installedPackageJsonPath = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'package.json');
const sourceWasmDir = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const copiedWasmDir = path.join(__dirname, '..', 'public', 'libs', 'mediapipe', 'wasm');

function fail(message) {
  console.error(`[verify-mediapipe-assets] ${message}`);
  process.exitCode = 1;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

if (!fs.existsSync(installedPackageJsonPath)) {
  fail(`@mediapipe/tasks-vision is not installed (expected ${installedPackageJsonPath} to exist). Run npm install.`);
  process.exit(1);
}

const installedVersion = JSON.parse(fs.readFileSync(installedPackageJsonPath, 'utf8')).version;

if (installedVersion !== PINNED_VERSION) {
  fail(
      `@mediapipe/tasks-vision is pinned to ${PINNED_VERSION} in package.json but ${installedVersion} is installed. `
      + 'If this version bump is intentional, re-copy public/libs/mediapipe/wasm/* from the new '
      + 'node_modules/@mediapipe/tasks-vision/wasm/*, update PINNED_VERSION in this script, and re-run.'
  );
}

if (!fs.existsSync(sourceWasmDir)) {
  fail(`Expected ${sourceWasmDir} to exist (installed package is missing its wasm/ folder).`);
  process.exit(1);
}
if (!fs.existsSync(copiedWasmDir)) {
  fail(`${copiedWasmDir} does not exist -- the self-hosted MediaPipe wasm files are missing from public/libs/mediapipe/wasm.`);
  process.exit(1);
}

const sourceFiles = fs.readdirSync(sourceWasmDir).sort();
const copiedFiles = fs.readdirSync(copiedWasmDir).sort();

if (sourceFiles.join(',') !== copiedFiles.join(',')) {
  fail(
      `public/libs/mediapipe/wasm does not have the same files as the installed package's wasm/ folder.\n`
      + `  installed: ${sourceFiles.join(', ')}\n`
      + `  copied:    ${copiedFiles.join(', ')}`
  );
} else {
  for (const file of sourceFiles) {
    const sourceHash = sha256(path.join(sourceWasmDir, file));
    const copiedHash = sha256(path.join(copiedWasmDir, file));

    if (sourceHash !== copiedHash) {
      fail(`public/libs/mediapipe/wasm/${file} does not byte-for-byte match the installed package's copy (sha256 mismatch).`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`[verify-mediapipe-assets] OK -- @mediapipe/tasks-vision@${installedVersion} matches the self-hosted wasm files.`);
