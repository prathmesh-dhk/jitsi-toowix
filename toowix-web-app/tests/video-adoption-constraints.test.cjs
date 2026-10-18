const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug, root-caused by downloading and reading the ACTUAL lib-jitsi-meet.min.js
// served at https://<domain>/libs/lib-jitsi-meet.min.js, not assumed: JitsiMeetJS.
// createLocalTracksFromMediaStreams([{ stream, mediaType: 'video', videoType: 'camera' }]) (no
// `constraints` field) crashed inside the library's OWN JitsiLocalTrack constructor with
// "Cannot read properties of undefined (reading 'height')" on every single video-track adoption
// (confirmed in production console logs, for a DESKTOP join too, not mobile-specific) -- the
// library builds its own _constraints from the track's live getHeight()/getWidth() when
// getConstraints() doesn't report both, and falls back AGAIN to constraints.height.ideal /
// constraints.width.ideal when those live values aren't valid numbers yet -- but `constraints`
// was never passed, so that fallback read .height off `undefined`. This always fell through to
// console.error + the fresh-acquisition fallback path (functionally recovered, but every join
// paid for a failed adoption attempt and a noisy error).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

const adoptionStart = source.indexOf('if (liveVideo) {');
const adoptionBlock = source.slice(adoptionStart, adoptionStart + 2400);

assert.ok(adoptionStart !== -1, 'expected to find the video adoption block');
assert.match(
  adoptionBlock,
  /mediaType:\s*'video',\s*videoType:\s*'camera',\s*constraints:\s*getPreferredCameraCaptureConstraints\(\)/,
  'the video adoption call must pass a `constraints` field (the shared builder) so lib-jitsi-meet never falls back to reading .height off an undefined constraints object'
);

console.log('PASS: local video-track adoption always supplies constraints, preventing the lib-jitsi-meet "reading \'height\' of undefined" crash on every join');
