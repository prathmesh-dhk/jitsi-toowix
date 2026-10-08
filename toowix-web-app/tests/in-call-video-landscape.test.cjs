const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: on macOS Chrome, the prejoin lobby preview showed the camera correctly
// landscape, but the SAME camera came in portrait-cropped (an extreme vertical zoom into the
// face) the moment the person actually joined. The lobby preview (useMediaPreview.ts) already
// requests explicit landscape width/height ideals for getUserMedia; the in-call track
// acquisition in useJitsiMeeting.ts did not, leaving the browser/camera driver free to pick
// something else once the call actually started. This is a static regression guard, same pattern
// as the other createLocalTrackWithRetry call-site tests -- it isn't unit-testable directly
// (these calls hit the real, globally-loaded JitsiMeetJS.createLocalTracks against a live camera).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(
    source,
    /function inCallVideoConstraints\(\): MediaTrackConstraints \{/,
    'must have a shared helper for the in-call landscape video constraints, not three separately drifting copies'
);
assert.match(source, /aspectRatio: \{ ideal: 16 \/ 9 \}/, 'in-call video must explicitly request a landscape aspect ratio, matching the lobby preview');
assert.match(source, /const ideal = getCameraCaptureIdeal\(\);/, 'must reuse the SAME ideal width/height/frameRate source the lobby preview uses (networkQuality.ts), not a second, possibly-drifting set of numbers');

// All three places a video track is acquired during/after a call must pass the constraint, not
// just the first (initial join) one. Matched as "{ video: inCallVideoConstraints() }" (the actual
// call-site usage), not a bare occurrence count, which would also match the function's own
// declaration ("function inCallVideoConstraints()").
const videoAcquisitionSites = (source.match(/devices: \[ 'video' \]/g) || []).length
    + (source.match(/devices: \[ isAudio \? 'audio' : 'video' \]/g) || []).length;
const constraintUses = (source.match(/\{ video: inCallVideoConstraints\(\) \}/g) || []).length;

assert.equal(videoAcquisitionSites, 3, 'test assumption check: expected exactly 3 call sites that can acquire a video track (initial join, ended-camera recovery, switchDevice) -- update this test if that count genuinely changed');
assert.equal(constraintUses, videoAcquisitionSites, 'every call site that can acquire a video track must pass the landscape constraint, not just some of them');

console.log('PASS in-call video acquisition explicitly requests landscape, matching the lobby preview, at every acquisition site');
