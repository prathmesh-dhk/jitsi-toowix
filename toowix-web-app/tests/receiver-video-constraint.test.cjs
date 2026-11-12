const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hook = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');
const preview = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useMediaPreview.ts'), 'utf8');
const quality = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'networkQuality.ts'), 'utf8');

assert.match(hook, /lowDataMode !== 'auto' \|\| manualMaxHeightRef\.current !== null/, 'baseline only in auto mode without a manual cap');
assert.ok(hook.includes('room.setReceiverConstraints({ lastN, defaultConstraints: { maxHeight: height } })'), 'defaultConstraints.maxHeight must reach the bridge');
assert.match(hook, /getReceiveMaxHeightForCallSize\(remoteParticipantCount \+ 1, screenShareActive\)/);
// Prejoin now spreads the SAME shared constraint builder the in-call path uses (see
// getPreferredCameraCaptureConstraints in networkQuality.ts -- this is the fix for the
// first-join-portrait-camera bug), rather than building its own width/height/frameRate literals.
assert.match(preview, /\.\.\.getPreferredCameraCaptureConstraints\(\)/, 'prejoin camera must request the highest ideal, not the browser default, via the shared constraint builder');
assert.match(quality, /height: 2160, width: 3840/, 'desktop camera ideal is 4K (clamped by the camera itself)');
assert.match(quality, /totalParticipants <= 2\) height = 2160/, 'one-to-one may go up to 4K');
assert.match(quality, /totalParticipants <= 4\) height = 1080/, 'small calls up to 1080p');


// P0-1 fix (Toowix_Meet_Prioritized_Issue_Backlog.pdf): the inline POOR/DEGRADED clamp used to
// apply the SAME ceiling to a screen share as to a camera tile (Math.min(base, 180) on POOR
// regardless of screenShareActive), even though `base` already requests 1080 specifically
// because a screen is being shared -- reported as the share going solid black on cellular. The
// clamp now lives in clampVideoHeightForNetwork (networkQuality.ts), which floors a screen share
// at 360 regardless of network state; this just checks the hook actually calls it with
// screenShareActive threaded through, and that the floor/ceiling logic itself is still present.
assert.ok(hook.includes('clampVideoHeightForNetwork(networkState, base, screenShareActive)'), 'receiver height clamp is screen-share aware');
assert.match(quality, /networkState === 'POOR'\)[^;]*return Math\.min\(base, 180\)/, 'camera-only weak network still lowers the requested video height');
assert.match(quality, /Math\.max\(360, Math\.min\(base, ceiling\)\)/, 'a screen share floors at 360 regardless of how bad the network gets');
assert.ok(hook.includes('getAudioMaxBitrateBps(networkState)'), 'voice bitrate follows the network state');
// Real reported bug: after a REMOTE participant stopped screen sharing, the call looked "limited"
// -- this effect's screenShareActive also reads remote desktop tracks, but the effect only used to
// re-run on the LOCAL isScreenSharing flag, so a remote-only share starting/stopping never
// re-applied the receiver/sender constraints for the new state. remoteScreenShares.length (real
// React state) must be a dependency too, not just isScreenSharing.
assert.ok(
  hook.includes('remoteParticipantCount, isScreenSharing, remoteScreenShares.length, networkState]'),
  'quality is re-evaluated whenever the network state OR a remote screen share starts/stops changes, not just local sharing'
);

console.log('PASS video quality can scale from 720p up to 1080p/4K with the camera and call size');
