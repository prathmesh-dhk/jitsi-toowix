const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: the PRESENTER's own screen share froze (stuck on the last frame) after
// clicking the BROWSER's own native "Stop sharing" bar -- but never when using the app's own
// "Stop presenting" button. Root-caused by downloading and reading the actual
// lib-jitsi-meet.min.js served by the Jitsi server, not assumed: JitsiTrack's
// _addMediaStreamInactiveHandler wires LOCAL_TRACK_STOPPED to `this.stream.oninactive` on every
// Chromium-based browser (not Firefox/WebKit, which get `track.onended` instead) --
// MediaStream.oninactive is a well-known-unreliable signal specifically for a getDisplayMedia()
// stream stopped via the browser's own native UI (as opposed to a script calling track.stop()),
// and frequently never fires. When it doesn't, LOCAL_TRACK_STOPPED never fires, the dedicated stop
// path never runs, and the UI is left showing the last frame of a now-dead track forever. The fix
// is a second, independent listener directly on the native track's own 'ended' event (not subject
// to the same oninactive flakiness), alongside (never instead of) the existing LOCAL_TRACK_STOPPED
// listener -- stopScreenShareInternal's own in-flight guard already absorbs whichever fires second.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

const localTrackStoppedIdx = source.indexOf('desktopTrack.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED');

assert.ok(localTrackStoppedIdx !== -1, 'expected the existing LOCAL_TRACK_STOPPED listener registration to still be present');

const afterListener = source.slice(localTrackStoppedIdx, localTrackStoppedIdx + 2600);

assert.match(
  afterListener,
  /nativeDesktopTrackForEndedListener\s*=\s*desktopTrack\.getTrack\?\.\(\)/,
  'must grab the REAL native MediaStreamTrack (desktopTrack.getTrack()), not rely solely on the JitsiTrack wrapper event'
);
assert.match(
  afterListener,
  /nativeDesktopTrackForEndedListener\?\.addEventListener\?\.\('ended',\s*\(\)\s*=>\s*\{/,
  'must attach a direct \'ended\' listener on the native track as a backstop, independent of LOCAL_TRACK_STOPPED/oninactive'
);
assert.match(
  afterListener,
  /if \(localDesktopTrackRef\.current === desktopTrack\) \{\s*\n\s*void stopScreenShareInternal\(desktopTrack\);\s*\n\s*\}\s*\}\);\s*\n\s*\} catch/,
  'the native \'ended\' backstop must go through the SAME stopScreenShareInternal dedicated stop path (whose in-flight guard absorbs a duplicate call), not a separate ad-hoc cleanup'
);

console.log('PASS: screen share stop has a native-track \'ended\' backstop listener, independent of lib-jitsi-meet\'s flaky Chromium MediaStream.oninactive-based LOCAL_TRACK_STOPPED signal');
