const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /const localSessionIdRef = useRef<string>/, 'must generate a per-tab/device session id, not rely on the shared JWT account id');
assert.match(source, /let roomInitialized = false/, 'must guard a connection against creating more than one conference');
assert.match(source, /if \(isStale\(\) \|\| roomInitialized\)/, 'duplicate connection-established events must be ignored');
assert.match(source, /const isLocalParticipantEvent =/, 'must centralize local/stale participant detection');
assert.match(source, /participantSessionId === localSessionIdRef\.current/, 'must identify stale self sessions by this tab\'s own session id, not the (shared, cross-device) JWT account id');
assert.match(source, /setLocalParticipantProperty\?\.\('deviceSessionId', localSessionIdRef\.current\)/, 'must broadcast this session\'s id before joining so remote/late-arriving self events can be matched against it');
assert.match(source, /TRACK_ADDED[\s\S]*?isLocalParticipantEvent\(participantId, trackParticipant\)/, 'self tracks must not enter the remote roster');
assert.match(source, /USER_JOINED[\s\S]*?isLocalParticipantEvent\(id, participant\)/, 'self presence must not create a remote participant tile');

console.log('PASS self participant and duplicate conference guards');
