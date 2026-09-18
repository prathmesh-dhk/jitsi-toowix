// Static regression guard for the adaptive-media contract. Browser tests still validate actual
// media delivery; this catches accidental removal of the supported Jitsi controls or a return to
// desktop-track replacement before a browser/staging environment is available.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hook = fs.readFileSync(path.join(root, 'src/lib/useJitsiMeeting.ts'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'src/lib/networkQuality.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');

assert.match(policy, /NETWORK_STATS_INTERVAL_MS = 2500/);
assert.match(policy, /NETWORK_RECOVERY_STABLE_MS = 10000/);
assert.match(policy, /'GOOD' \| 'DEGRADED' \| 'POOR' \| 'RECOVERING'/);
assert.match(policy, /'auto' \| 'low-data' \| 'audio-only'/);
assert.match(hook, /getActivePeerConnection\?\.\(\)/);
assert.match(hook, /peerConnection\.getStats\(\)/);
assert.match(hook, /setLastN\?\.\(policy\.lastN\)/);
assert.match(hook, /setReceiverVideoConstraint\?\.\(policy\.receiveMaxHeight\)/);
assert.match(hook, /setSenderVideoConstraint\?\.\(policy\.sendMaxHeight\)/);
assert.match(hook, /room\.removeTrack\(desktopTrack\)/);
assert.doesNotMatch(hook, /replaceTrack\(desktopTrack/);
assert.match(page, /Data usage/);
assert.match(policy, /Audio priority mode/);

console.log('Adaptive network-quality static contract verified.');
