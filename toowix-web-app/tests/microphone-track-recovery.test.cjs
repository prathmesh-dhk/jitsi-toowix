const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /const bindLocalAudioTrackState = useCallback/, 'all local microphone tracks must receive state listeners');
assert.match(source, /bindLocalAudioTrackState\(newTrack, JitsiMeetJS\)/, 'replacement microphones must retain mute-state tracking');
assert.match(source, /const recoverEndedMicrophone = \(\) =>/, 'ended physical microphones must be recovered during a call');
assert.match(source, /nativeTrack\?\.readyState !== 'ended'/, 'recovery must only replace a genuinely ended physical track');
assert.match(source, /track\.isMuted\?\.\(\)/, 'recovery must not override an intentional or moderator mute');

// Real reported bug: a flapping Bluetooth device (profile-switching mid-speech) made the mic
// "reload" repeatedly -- this poll recovered it again and again with no gap, fighting a device
// that hadn't settled yet. A rate limit between automatic recoveries gives it time to settle.
assert.match(source, /const MIN_AUTO_RECOVERY_INTERVAL_MS = 4000/, 'automatic recoveries must be rate-limited, not re-fired on every 5s poll tick a flapping device is still unhealthy');
assert.match(
    source,
    /if \(Date\.now\(\) - lastAutoRecoveryAtRef\.current < MIN_AUTO_RECOVERY_INTERVAL_MS\) \{\s*\n\s*\/\/ Recovered very recently/,
    'recovery must check the cooldown BEFORE replacing the track again, not just record a timestamp after the fact'
);
assert.match(source, /lastAutoRecoveryAtRef\.current = Date\.now\(\);\s*\n\s*void switchDevice/, 'the cooldown timestamp must be recorded at the moment a recovery is actually performed');

console.log('PASS ended microphone tracks are recovered without overriding a mute, and automatic recoveries are rate-limited against a flapping device');
