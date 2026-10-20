const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: sharing a tab/window/entire screen WITH the browser's own "Share audio"
// checkbox never actually transmitted any audio to other participants. Root cause, confirmed by
// downloading and reading the actual lib-jitsi-meet.min.js served by the Jitsi server (not
// assumed): the mixing code called `microphoneJitsiTrack.replaceTrack(mixedTrack)` to swap the
// published mic sender's source -- but JitsiLocalTrack has NO replaceTrack method at all (its
// real methods are mute/unmute/setEffect/stopStream/isMuted/setSourceName/setSsrc and a handful
// of device-switch internals). The call site's own defensive
// `typeof microphoneJitsiTrack.replaceTrack !== 'function'` guard was therefore always true,
// throwing immediately and silently falling back to a video-only share on every single attempt.
// Fixed by using setEffect() -- the real, public mechanism this codebase already uses
// successfully for virtual background and noise suppression -- via a new DesktopAudioMixEffect
// class (desktopAudioMixEffect.ts) that mixes the mic with the shared source's own audio track.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'desktopAudioMixEffect.ts'), 'utf8');

assert.match(
  source,
  /import \{ DesktopAudioMixEffect \} from '\.\/jitsi\/desktopAudioMixEffect';/,
  'useJitsiMeeting.ts must import the real fix'
);
const mixStart = source.indexOf('const mixEffect = new DesktopAudioMixEffect(displayAudioTrack, restoreMuted);');

assert.notEqual(mixStart, -1, 'expected the screen-share-audio start path to construct a DesktopAudioMixEffect');
const mixBlock = source.slice(mixStart, mixStart + 400);

assert.match(mixBlock, /await microphoneJitsiTrack\.setEffect\(mixEffect\);/, 'must apply the mix via the real setEffect() API');
assert.match(
  mixBlock,
  /desktopShareAudioMixRef\.current = \{ jitsiTrack: microphoneJitsiTrack, effect: mixEffect, restoreMuted \};/,
  'must track the effect instance (not a raw replaced track) for later cleanup'
);

const stopFnStart = source.indexOf('const stopDesktopShareAudio = useCallback(async () => {');

assert.notEqual(stopFnStart, -1, 'expected stopDesktopShareAudio to still exist');
const stopFnBlock = source.slice(stopFnStart, stopFnStart + 700);

assert.match(stopFnBlock, /await mix\.jitsiTrack\.setEffect\(undefined\);/, 'stopping screen-share audio must clear the effect via setEffect(undefined), the real removal API');
assert.doesNotMatch(stopFnBlock, /\.replaceTrack\(/, 'the stop path must not call the non-existent replaceTrack either');

// desktopAudioMixEffect.ts: must match the exact setEffect-compatible shape
// (startEffect/isEnabled/stopEffect) that NoiseSuppressionEffect.ts already proves works.
assert.match(effectSource, /startEffect\(micStream: MediaStream\): MediaStream \{/, 'must implement startEffect(stream): MediaStream, the real setEffect() contract');
assert.match(effectSource, /isEnabled\(sourceLocalTrack: \{ isAudioTrack: \(\) => boolean \}\): boolean \{/, 'must implement isEnabled(track): boolean, the real setEffect() contract');
assert.match(effectSource, /stopEffect\(\): void \{/, 'must implement stopEffect(): void, the real setEffect() contract');
// Both the mic and the shared source's audio must actually reach the destination mix.
assert.match(effectSource, /this\._micSource\.connect\(this\._micGain\)\.connect\(this\._destination\)/, 'the mic must be connected into the mixed output');
assert.match(effectSource, /this\._displaySource\.connect\(this\._destination\)/, 'the shared source\'s own audio must be connected into the mixed output');
assert.match(effectSource, /return this\._destination\.stream;/, 'startEffect must return the mixed destination stream for setEffect() to actually transmit');

console.log('PASS: screen-share "Share audio" now mixes the mic and the shared source\'s audio via the real setEffect() API (not the non-existent replaceTrack), so audio actually reaches other participants');
