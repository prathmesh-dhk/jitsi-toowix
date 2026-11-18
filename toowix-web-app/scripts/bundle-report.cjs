#!/usr/bin/env node
// P2-9 fix (2G/3G performance plan): "Add a repeatable bundle report after `vite build`... CI
// should fail on unexplained regressions." Runs after every build (see package.json's "build"
// script) against dist/.vite/manifest.json (enabled in vite.config.ts) -- that manifest is the
// real, authoritative output graph (which chunks are STATIC `imports` vs lazy `dynamicImports` of
// which other chunks), so this measures actual shipped bytes instead of guessing from source.
//
// Three checks, matching the plan's own suggested budgets:
//   1. Root entry's static import closure (what a login/home/any-page load downloads before
//      anything route-specific) stays under ROOT_INITIAL_JS_BUDGET_BYTES gzip.
//   2. MeetingRoomPage's own static import closure, MINUS whatever the root entry already shares
//      (so nothing is double-counted), stays under MEETING_CHUNK_BUDGET_BYTES gzip. lib-jitsi-meet
//      itself is loaded directly from the Jitsi server (config.js/lib-jitsi-meet.min.js, see
//      ensureLibJitsiMeetLoaded.ts) -- never part of this app's own bundle -- so no separate
//      exclusion is needed for it.
//   3. No individual initial CSS file (root entry's or the meeting chunk's own) exceeds
//      INITIAL_CSS_BUDGET_BYTES gzip.
// A fourth check verifies the thing P1-7/P2-10 already rely on structurally: virtual-background
// code (MediaPipe/tasks-vision, the segmentation effect, tflite) must only be reachable through a
// dynamicImport, never a static one, from either the root entry or the meeting chunk -- i.e. it
// is never downloaded just by loading the app or joining a meeting, only when the feature is
// actually turned on.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const MANIFEST_PATH = path.join(DIST_DIR, '.vite', 'manifest.json');

const ROOT_INITIAL_JS_BUDGET_BYTES = 150 * 1024;
const MEETING_CHUNK_BUDGET_BYTES = 350 * 1024;
const INITIAL_CSS_BUDGET_BYTES = 100 * 1024;

const VIRTUAL_BACKGROUND_SOURCE_PATTERN = /virtualBackground|mediapipe|tasks-vision|NoiseSuppressionEffect/i;

function fail(message) {
  console.error(`[bundle-report] FAIL: ${message}`);
  process.exitCode = 1;
}

function gzipSizeOf(relativeFile) {
  const buf = fs.readFileSync(path.join(DIST_DIR, relativeFile));

  return zlib.gzipSync(buf, { level: zlib.constants.Z_BEST_COMPRESSION }).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Walks only STATIC `imports` (never `dynamicImports`) from a manifest key, collecting every
// chunk's own `.file` and `.css` entries -- including the root key's own `.file` itself (e.g.
// index.html's manifest entry has a real `.file` pointing at the actual entry JS bundle, it's
// only the "index.html" KEY that isn't itself a downloadable asset).
function collectStaticClosure(manifest, rootKey, seen = new Set(), files = new Set(), cssFiles = new Set()) {
  if (seen.has(rootKey)) return { files, cssFiles };
  seen.add(rootKey);
  const entry = manifest[rootKey];

  if (!entry) return { files, cssFiles };
  if (entry.file) files.add(entry.file);
  for (const css of entry.css || []) cssFiles.add(css);
  for (const dep of entry.imports || []) collectStaticClosure(manifest, dep, seen, files, cssFiles);

  return { files, cssFiles };
}

if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`${MANIFEST_PATH} does not exist -- did "vite build" run with build.manifest enabled (see vite.config.ts)?`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const rootEntryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const meetingEntryKey = Object.keys(manifest).find((key) => manifest[key].name === 'MeetingRoomPage');

if (!rootEntryKey) {
  fail('No isEntry chunk found in the manifest -- expected index.html\'s own entry.');
  process.exit(1);
}
if (!meetingEntryKey) {
  fail('No "MeetingRoomPage" chunk found in the manifest -- expected App.tsx\'s lazy(() => import(\'./pages/MeetingRoomPage\')) split to produce one.');
  process.exit(1);
}

const root = collectStaticClosure(manifest, rootEntryKey);
const meetingRaw = collectStaticClosure(manifest, meetingEntryKey);
// Budget #2 only counts what the meeting route adds ON TOP of what every page already pays for.
const meetingOnlyFiles = new Set([ ...meetingRaw.files ].filter((file) => !root.files.has(file)));
const meetingOnlyCss = new Set([ ...meetingRaw.cssFiles ].filter((file) => !root.cssFiles.has(file)));

const rootJsBytes = [ ...root.files ].reduce((sum, file) => sum + gzipSizeOf(file), 0);
const meetingJsBytes = [ ...meetingOnlyFiles ].reduce((sum, file) => sum + gzipSizeOf(file), 0);

console.log('[bundle-report] Root entry (every page) static JS:');
for (const file of root.files) console.log(`  ${file}  (gzip ${formatKb(gzipSizeOf(file))})`);
console.log(`  TOTAL: ${formatKb(rootJsBytes)} (budget ${formatKb(ROOT_INITIAL_JS_BUDGET_BYTES)})`);

console.log('\n[bundle-report] MeetingRoomPage route static JS, excluding what the root entry already ships:');
for (const file of meetingOnlyFiles) console.log(`  ${file}  (gzip ${formatKb(gzipSizeOf(file))})`);
console.log(`  TOTAL: ${formatKb(meetingJsBytes)} (budget ${formatKb(MEETING_CHUNK_BUDGET_BYTES)})`);

if (rootJsBytes > ROOT_INITIAL_JS_BUDGET_BYTES) {
  fail(`root entry initial JS is ${formatKb(rootJsBytes)}, over the ${formatKb(ROOT_INITIAL_JS_BUDGET_BYTES)} budget.`);
}
if (meetingJsBytes > MEETING_CHUNK_BUDGET_BYTES) {
  fail(`MeetingRoomPage's own initial JS is ${formatKb(meetingJsBytes)}, over the ${formatKb(MEETING_CHUNK_BUDGET_BYTES)} budget.`);
}

console.log('\n[bundle-report] Initial CSS:');
for (const cssFile of new Set([ ...root.cssFiles, ...meetingOnlyCss ])) {
  const size = gzipSizeOf(cssFile);

  console.log(`  ${cssFile}  (gzip ${formatKb(size)})`);
  if (size > INITIAL_CSS_BUDGET_BYTES) {
    fail(`${cssFile} is ${formatKb(size)} gzipped, over the ${formatKb(INITIAL_CSS_BUDGET_BYTES)} per-file budget.`);
  }
}

const isVirtualBackgroundSource = (key) => VIRTUAL_BACKGROUND_SOURCE_PATTERN.test(key);
const vbReachableFromRoot = [ ...root.files ].some((file) =>
  Object.keys(manifest).some((key) => manifest[key].file === file && isVirtualBackgroundSource(key)));
const vbReachableFromMeeting = [ ...meetingRaw.files ].some((file) =>
  Object.keys(manifest).some((key) => manifest[key].file === file && isVirtualBackgroundSource(key)));

if (vbReachableFromRoot || vbReachableFromMeeting) {
  fail('virtual-background/MediaPipe/noise-suppression code is reachable via a STATIC import -- it must only ever be a dynamicImport, loaded on demand.');
} else {
  console.log('\n[bundle-report] OK: virtual-background/MediaPipe/noise-suppression code is only reachable via dynamicImports (never loaded on an ordinary page or meeting join).');
}

if (process.exitCode) {
  console.error('\n[bundle-report] One or more budgets were exceeded. If this is an intentional, reviewed change, update the budgets in scripts/bundle-report.cjs alongside it.');
} else {
  console.log('\n[bundle-report] All budgets passed.');
}
