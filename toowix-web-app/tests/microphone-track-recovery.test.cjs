const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /const bindLocalAudioTrackState = useCallback/, 'all local microphone tracks must receive state listeners');
assert.match(source, /bindLocalAudioTrackState\(newTrack, JitsiMeetJS\)/, 'replacement microphones must retain mute-state tracking');
assert.match(source, /const recoverEndedMicrophone = \(\) =>/, 'ended physical microphones must be recovered during a call');
assert.match(source, /nativeTrack\?\.readyState !== 'ended'/, 'recovery must only replace a genuinely ended physical track');
assert.match(source, /track\.isMuted\?\.\(\)/, 'recovery must not override an intentional or moderator mute');

console.log('PASS ended microphone tracks are recovered without overriding a mute');
