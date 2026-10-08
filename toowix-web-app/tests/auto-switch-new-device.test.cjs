const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Explicit requirement: auto-switch to a newly-appeared device must exist, must react within
// "milliseconds" (a short debounce, not the original 500ms), and must keep working correctly
// through repeated connect/disconnect/reconnect cycles of the same physical device. This isn't
// unit-testable directly (refresh() closes over a large amount of component state inside
// MeetingRoomPage.tsx and only runs inside a mounted component against the real browser device
// APIs) -- this is a static regression guard, same pattern as
// tests/background-sender-hysteresis.test.cjs and tests/device-change-debounce.test.cjs.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

// Auto-switch-to-new-device must exist.
assert.match(
    source,
    /const knownDeviceIdsRef = useRef<Set<string> \| null>\(null\);/,
    'must track the previous device-list snapshot to detect newly-appeared devices'
);
assert.match(
    source,
    /const isNew = \(d: MediaDeviceInfo\) => !previousIds\.has\(d\.deviceId\);/,
    'must detect devices that are new since the last settled snapshot'
);
assert.match(
    source,
    /if \(newAudioIn && !audioId\) \{\s*\n\s*setAudioId\(newAudioIn\.deviceId\);\s*\n\s*void applyJitsiDevice\('audioInput', newAudioIn\.deviceId\);/,
    'must auto-switch the microphone to a newly-appeared device (only when nothing was explicitly picked, so it never fights a deliberate choice)'
);

// The snapshot must only update on an actually-settled refresh (not per raw event), so each
// connect/disconnect cycle is diffed against the correct previous state, not a half-updated one.
assert.match(
    source,
    /const currentIds = new Set\(result\.map\(\(d\) => d\.deviceId\)\.filter\(Boolean\)\);\s*\n\s*const previousIds = knownDeviceIdsRef\.current;\s*\n\s*\n\s*knownDeviceIdsRef\.current = currentIds;/,
    'the snapshot must be captured and updated inside the (debounced, settled) refresh(), not per raw devicechange event'
);

// Reacts in "milliseconds", not the old 500ms -- short enough to feel instant, still long enough
// to coalesce a Bluetooth pairing handshake's burst of devicechange events.
assert.match(source, /\}, 200\);/, 'the settle delay must be short (around 200ms) so device switching feels close to instant, not the earlier 500ms');
assert.doesNotMatch(source, /\}, 500\);/, 'must not still use the old, slower 500ms settle delay');

console.log('PASS auto-switch to a newly-appeared device exists, reacts quickly, and is based on a correctly-updated snapshot');
