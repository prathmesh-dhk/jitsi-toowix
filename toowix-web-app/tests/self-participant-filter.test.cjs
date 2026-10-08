const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');
// The actual event-listener wiring (isLocalParticipantEvent and its TRACK_ADDED/USER_JOINED call
// sites) was extracted into its own module during the Track 3 split; the session-id setup itself
// (declaring/broadcasting localSessionIdRef, the single-conference guard) stayed in the hook.
const conferenceEvents = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'useConferenceEvents.ts'), 'utf8');

assert.match(source, /const localSessionIdRef = useRef<string>/, 'must generate a per-tab/device session id, not rely on the shared JWT account id');
assert.match(source, /let roomInitialized = false/, 'must guard a connection against creating more than one conference');
assert.match(source, /if \(isStale\(\) \|\| roomInitialized\)/, 'duplicate connection-established events must be ignored');
assert.match(conferenceEvents, /const isLocalParticipantEvent =/, 'must centralize local/stale participant detection (now in useConferenceEvents.ts)');
assert.match(conferenceEvents, /participantSessionId === localSessionIdRef\.current/, 'must identify stale self sessions by this tab\'s own session id, not the (shared, cross-device) JWT account id (now in useConferenceEvents.ts)');
assert.match(source, /setLocalParticipantProperty\?\.\('deviceSessionId', localSessionIdRef\.current\)/, 'must broadcast this session\'s id before joining so remote/late-arriving self events can be matched against it');
assert.match(conferenceEvents, /TRACK_ADDED[\s\S]*?isLocalParticipantEvent\(participantId, trackParticipant\)/, 'self tracks must not enter the remote roster (now in useConferenceEvents.ts)');
assert.match(conferenceEvents, /USER_JOINED[\s\S]*?isLocalParticipantEvent\(id, participant\)/, 'self presence must not create a remote participant tile (now in useConferenceEvents.ts)');

console.log('PASS self participant and duplicate conference guards');
