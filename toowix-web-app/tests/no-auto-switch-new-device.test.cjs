const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Explicit user requirement: "no auto-switch at all -- only switch when I pick it." The app must
// never jump onto a newly-appeared audio/video device on its own (a Bluetooth headset finishing
// its pairing handshake, a webcam being plugged in) -- only fall back away from the CURRENTLY
// SELECTED device if it disappears. Auto-connecting to every new device sighting was also half of
// what caused the earlier "mic keeps disconnecting/reconnecting" bug, since a Bluetooth pairing
// handshake makes a device appear/disappear/reappear several times in a row.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

assert.doesNotMatch(
    source,
    /const isNew = \(d: MediaDeviceInfo\) => !previousIds\.has\(d\.deviceId\)/,
    'must not auto-detect "new" devices by diffing the device list -- that mechanism is what used to drive unsolicited auto-switching'
);
assert.doesNotMatch(
    source,
    /newAudioIn && !audioId/,
    'must not auto-switch the microphone to a newly-appeared device'
);
assert.doesNotMatch(
    source,
    /knownDeviceIdsRef/,
    'the device-list snapshot ref used only for new-device detection must be gone, not just unused'
);

// The disappear-fallback (needed so an unplugged/dropped device doesn't leave the person silently
// talking to no one) must still be present.
assert.match(
    source,
    /if \(audioId && audioInput\.length && !audioInput\.some\(\(d\) => d\.deviceId === audioId\)\) \{/,
    'falling back when the SELECTED microphone disappears must still work -- only auto-connecting to a new one was removed'
);

console.log('PASS the app never auto-switches onto a newly-appeared device; only falls back when the selected device disappears');
