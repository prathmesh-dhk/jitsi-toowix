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
// A later bug (first-join portrait camera, fixed after this test was written) found that the
// lobby preview and in-call acquisition still had their OWN constraint-building code even though
// both called getCameraCaptureIdeal() -- the fix was to delegate the ENTIRE constraint object
// (including the landscape/portrait aspectRatio logic) to one function in networkQuality.ts, used
// identically everywhere, rather than just sharing the width/height/frameRate numbers. See that
// file's own comment for the full story.
const networkQuality = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'networkQuality.ts'), 'utf8');

assert.match(
    source,
    /function inCallVideoConstraints\(\): MediaTrackConstraints \{\s*\n\s*return getPreferredCameraCaptureConstraints\(\);/,
    'must have a shared helper for the in-call landscape video constraints, not three separately drifting copies, and it must delegate entirely to the one true shared builder'
);
assert.match(
    networkQuality,
    /export function getPreferredCameraCaptureConstraints\(\): MediaTrackConstraints \{/,
    'the single shared camera constraint builder must live in networkQuality.ts'
);
// UPDATED: a later fix (mobile portrait capture/transmission report) found that always
// hard-requesting portrait for a phone was itself wrong -- a phone held SIDEWAYS should request
// landscape, not fight the way it's actually being held. getCameraCaptureOrientationPreference()
// reads the real screen/orientation signal (falling back to portrait when unavailable, preserving
// this test's original desktop/tablet-landscape, phone-portrait-by-default intent). The underlying
// guarantee this test exists to protect -- desktop/tablet always request landscape, a phone's
// request follows its actual orientation -- still holds; only the phone branch got smarter.
assert.match(
    networkQuality,
    /const aspectRatio = getCameraCaptureOrientationPreference\(\) === 'portrait' \? 9 \/ 16 : 16 \/ 9;/,
    'in-call video must explicitly request a landscape aspect ratio on desktop/tablet, matching the lobby preview -- and the real current orientation on phone'
);
assert.match(
    networkQuality,
    /export function getCameraCaptureOrientationPreference\(\): CameraCaptureOrientation \{/,
    'desktop/tablet must still be hardcoded to landscape -- only a phone has a real orientation-dependent preference'
);
assert.match(
    networkQuality,
    /if \(getCameraDeviceCategory\(\) !== 'phone'\) return 'landscape';/,
    'desktop/tablet must never consult screen/orientation APIs -- they always prefer landscape, unconditionally'
);

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
