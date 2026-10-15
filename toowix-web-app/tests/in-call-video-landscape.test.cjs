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
// UPDATED AGAIN: a live side-by-side test against stock Jitsi Meet's own web client (same
// device, same browser) found that orientation-aware width/height swapping and an aspectRatio
// constraint made no difference to what a phone's camera actually delivered -- mobile portrait
// capture is now an explicitly out-of-scope problem for this web client (a native app is the
// planned fix). getPreferredCameraCaptureConstraints() no longer branches on orientation at all,
// for ANY device category -- the same plain resolution request goes out every time, matching
// stock Jitsi's own request. getCameraCaptureOrientationPreference() still exists (used only for
// the diagnostic console warning in verifyCameraCaptureOrientation), but no longer drives what
// gets requested.
assert.match(
    networkQuality,
    /export function getPreferredCameraCaptureConstraints\(\): MediaTrackConstraints \{\s*\n\s*const ideal = getCameraCaptureIdeal\(\);/,
    'in-call video must delegate to getCameraCaptureIdeal() alone -- no separate orientation-based aspectRatio logic'
);
{
  const start = networkQuality.indexOf('export function getPreferredCameraCaptureConstraints');
  const end = networkQuality.indexOf('export function', start + 1);
  const functionBody = networkQuality.slice(start, end === -1 ? undefined : end);

  assert.doesNotMatch(
      functionBody,
      /aspectRatio|advanced/,
      'getPreferredCameraCaptureConstraints must not add an aspectRatio or advanced field -- a plain resolution request only'
  );
}
assert.match(
    networkQuality,
    /export function getCameraCaptureOrientationPreference\(\): CameraCaptureOrientation \{/,
    'the orientation-preference function still exists for diagnostics (verifyCameraCaptureOrientation\'s warning), even though it no longer drives the capture request'
);

// All three places a video track is acquired during/after a call must pass the constraint, not
// just the first (initial join) one. Matched as "{ video: inCallVideoConstraints() }" (the actual
// call-site usage), not a bare occurrence count, which would also match the function's own
// declaration ("function inCallVideoConstraints()").
const videoAcquisitionSites = (source.match(/devices: \[ 'video' \]/g) || []).length
    + (source.match(/devices: \[ isAudio \? 'audio' : 'video' \]/g) || []).length;
const constraintUses = (source.match(/\{ video: inCallVideoConstraints\(\) \}/g) || []).length;

assert.equal(videoAcquisitionSites, 3, 'test assumption check: expected exactly 3 call sites that can acquire a video track (initial join, ended-camera recovery, switchDevice) -- update this test if that count genuinely changed');
assert.equal(constraintUses, videoAcquisitionSites, 'every call site that can acquire a video track must pass the shared constraint builder, not just some of them');

console.log('PASS in-call video acquisition uses the one shared, orientation-agnostic constraint builder, matching the lobby preview, at every acquisition site');
