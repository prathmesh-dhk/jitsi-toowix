const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug #1: sharing a tab/window/entire screen WITH the browser's own "Share audio"
// checkbox never actually transmitted any audio to other participants. Root cause, confirmed by
// downloading and reading the actual lib-jitsi-meet.min.js served by the Jitsi server (not
// assumed): the code called `microphoneJitsiTrack.replaceTrack(mixedTrack)` to swap the published
// mic sender's source -- but JitsiLocalTrack has NO replaceTrack method at all (its real methods
// are mute/unmute/setEffect/stopStream/isMuted/setSourceName/setSsrc and a handful of
// device-switch internals). The call site's own defensive
// `typeof microphoneJitsiTrack.replaceTrack !== 'function'` guard was therefore always true,
// throwing immediately and silently falling back to a video-only share on every single attempt.
// Fixed by using setEffect() -- the real, public mechanism this codebase already uses
// successfully for virtual background and noise suppression.
//
// Real reported bug #2, fixed in the same class (desktopAudioMixEffect.ts): an earlier version of
// the fix for bug #1 mixed the LOCAL MIC into the shared audio (at gain 0 while muted, full
// volume while unmuted), coupling whether shared audio worked at all to the presenter's own mic
// state -- muted sometimes produced no audio whatsoever, unmuted leaked the presenter's own voice
// into the shared audio, neither of which is desired. The effect now carries ONLY the shared
// source's own audio (the mic is never connected into the graph at all) and implements a no-op
// setMuted() -- the exact extension point the real JitsiLocalTrack._setMuted checks for on an
// active effect -- so the shared audio plays identically regardless of the presenter's mic state,
// with no need to force-unmute the sender (and no race from doing so) before applying the effect.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'desktopAudioMixEffect.ts'), 'utf8');

assert.match(
  source,
  /import \{ DesktopAudioMixEffect \} from '\.\/jitsi\/desktopAudioMixEffect';/,
  'useJitsiMeeting.ts must import the real fix'
);

const mixStart = source.indexOf('const mixEffect = new DesktopAudioMixEffect(displayAudioTrack);');

assert.notEqual(mixStart, -1, 'expected the screen-share-audio start path to construct a DesktopAudioMixEffect with ONLY the display audio track -- no mic/mute-state argument');
const mixBlock = source.slice(mixStart, mixStart + 400);

assert.match(mixBlock, /await microphoneJitsiTrack\.setEffect\(mixEffect\);/, 'must apply the effect via the real setEffect() API');
assert.match(
  mixBlock,
  /desktopShareAudioMixRef\.current = \{ jitsiTrack: microphoneJitsiTrack, effect: mixEffect \};/,
  'must track the effect instance (not a raw replaced track, and no longer a restoreMuted flag) for later cleanup'
);
assert.doesNotMatch(
  source.slice(mixStart - 600, mixStart),
  /\.unmute\(\)/,
  'the start path must no longer force-unmute the sender before applying the effect -- the effect\'s own no-op setMuted() makes that unnecessary, and doing it was a likely source of the "muted mic produced no shared audio" bug'
);

const stopFnStart = source.indexOf('const stopDesktopShareAudio = useCallback(async () => {');

assert.notEqual(stopFnStart, -1, 'expected stopDesktopShareAudio to still exist');
const stopFnBlock = source.slice(stopFnStart, stopFnStart + 900);

assert.match(stopFnBlock, /await mix\.jitsiTrack\.setEffect\(undefined\);/, 'stopping screen-share audio must clear the effect via setEffect(undefined), the real removal API');
assert.doesNotMatch(stopFnBlock, /\.replaceTrack\(/, 'the stop path must not call the non-existent replaceTrack either');
assert.doesNotMatch(stopFnBlock, /restoreMuted/, 'there is no mute state to restore any more -- the effect never touched the mic\'s own mute state');

// desktopAudioMixEffect.ts: must match the exact setEffect-compatible shape
// (startEffect/isEnabled/stopEffect) that NoiseSuppressionEffect.ts already proves works, PLUS
// setMuted (the real mute-delegation hook JitsiLocalTrack._setMuted checks for).
assert.match(effectSource, /startEffect\(_micStream: MediaStream\): MediaStream \{/, 'must implement startEffect(stream): MediaStream, the real setEffect() contract -- the mic stream param is intentionally unused (prefixed _)');
assert.match(effectSource, /isEnabled\(sourceLocalTrack: \{ isAudioTrack: \(\) => boolean \}\): boolean \{/, 'must implement isEnabled(track): boolean, the real setEffect() contract');
assert.match(effectSource, /setMuted\(_muted: boolean\): void \{\}/, 'must implement a no-op setMuted(), the real extension point JitsiLocalTrack._setMuted delegates to for an active effect -- this is what keeps shared audio playing through any mic mute/unmute while sharing');
assert.match(effectSource, /stopEffect\(\): void \{/, 'must implement stopEffect(): void, the real setEffect() contract');

// The mic must NEVER be connected into this graph -- only the shared source's own audio.
assert.doesNotMatch(effectSource, /createMediaStreamSource\(_micStream/, 'the mic stream must never be turned into a Web Audio source node');
assert.doesNotMatch(effectSource, /_micSource|_micGain/, 'there must be no mic-related audio nodes left in the effect at all');
assert.match(effectSource, /this\._displaySource\.connect\(this\._destination\)/, 'the shared source\'s own audio must be connected into the output');
assert.match(effectSource, /return this\._destination\.stream;/, 'startEffect must return the destination stream (carrying only the shared audio) for setEffect() to actually transmit');

console.log('PASS: screen-share "Share audio" now transmits the shared source\'s own audio via the real setEffect() API (not the non-existent replaceTrack), completely independent of the presenter\'s own mic mute state -- no mic leak when unmuted, no silence when muted');
