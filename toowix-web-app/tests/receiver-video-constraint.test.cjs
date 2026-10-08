const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hook = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');
const preview = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useMediaPreview.ts'), 'utf8');
const quality = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'networkQuality.ts'), 'utf8');

assert.match(hook, /lowDataMode !== 'auto' \|\| manualMaxHeightRef\.current !== null/, 'baseline only in auto mode without a manual cap');
assert.ok(hook.includes('room.setReceiverConstraints({ lastN, defaultConstraints: { maxHeight: height } })'), 'defaultConstraints.maxHeight must reach the bridge');
assert.match(hook, /getReceiveMaxHeightForCallSize\(remoteParticipantCount \+ 1, screenShareActive\)/);
assert.match(preview, /height: \{ ideal: captureIdeal\.height \}/, 'prejoin camera must request the highest ideal, not the browser default');
assert.match(quality, /height: 2160, width: 3840/, 'desktop camera ideal is 4K (clamped by the camera itself)');
assert.match(quality, /totalParticipants <= 2\) height = 2160/, 'one-to-one may go up to 4K');
assert.match(quality, /totalParticipants <= 4\) height = 1080/, 'small calls up to 1080p');


assert.ok(hook.includes("networkState === 'POOR' ? Math.min(base, 180)"), 'weak network lowers the requested video height');
assert.ok(hook.includes('getAudioMaxBitrateBps(networkState)'), 'voice bitrate follows the network state');
// Real reported bug: after a REMOTE participant stopped screen sharing, the call looked "limited"
// -- this effect's screenShareActive also reads remote desktop tracks, but the effect only used to
// re-run on the LOCAL isScreenSharing flag, so a remote-only share starting/stopping never
// re-applied the receiver/sender constraints for the new state. remoteScreenShares.length (real
// React state) must be a dependency too, not just isScreenSharing.
assert.ok(
  hook.includes('remoteParticipantCount, isScreenSharing, remoteScreenShares.length, networkState ]'),
  'quality is re-evaluated whenever the network state OR a remote screen share starts/stops changes, not just local sharing'
);

console.log('PASS video quality can scale from 720p up to 1080p/4K with the camera and call size');
