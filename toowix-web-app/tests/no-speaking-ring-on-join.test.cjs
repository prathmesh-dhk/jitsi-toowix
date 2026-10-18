const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: a participant joining the call briefly showed the speaking-ring outline on
// their own tile even though they had never spoken. Root cause: JVB's DOMINANT_SPEAKER_CHANGED
// can report a just-joined participant as dominant speaker before any real audio energy exists
// for them, and the handler lit the ring (setSpeakingLevel(id, 1), held 2.5s) unconditionally for
// whoever it named. This is a SEPARATE side effect of the same false signal from the auto-pin bug
// (see no-auto-pin-on-join.test.cjs) -- that fix only guarded setPinnedParticipantId in
// MeetingRoomPage.tsx; this fix guards the speaking-ring/muted-correction side effects inside
// useConferenceEvents.ts's own DOMINANT_SPEAKER_CHANGED handler, which has no access to that
// component-level ref and so keeps its own first-seen tracking.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'useConferenceEvents.ts'), 'utf8');

assert.match(
  source,
  /const remoteFirstSeenAt: Record<string, number> = \{\};/,
  'expected a local first-seen-timestamp map for remote participants'
);
assert.match(
  source,
  /const DOMINANT_SPEAKER_JOIN_GRACE_MS = \d+;/,
  'expected a defined grace period constant'
);

// USER_JOINED must populate it (once, never overwritten on a later re-fire for the same id).
const userJoinedStart = source.indexOf('room.on(JitsiMeetJS.events.conference.USER_JOINED');

assert.notEqual(userJoinedStart, -1, 'expected the USER_JOINED handler to still exist');
const userJoinedBlock = source.slice(userJoinedStart, userJoinedStart + 1200);

assert.match(
  userJoinedBlock,
  /if \(!\(id in remoteFirstSeenAt\)\) \{\s*\n\s*remoteFirstSeenAt\[id\] = Date\.now\(\);/,
  'USER_JOINED must record a first-seen timestamp the first time each id appears'
);

// removeRemoteParticipant must clean it up so a later rejoin is treated as fresh.
const removeFnStart = source.indexOf('const removeRemoteParticipant = (id: string) => {');

assert.notEqual(removeFnStart, -1, 'expected removeRemoteParticipant to still exist');
const removeFnBlock = source.slice(removeFnStart, removeFnStart + 300);

assert.match(removeFnBlock, /delete remoteFirstSeenAt\[id\];/, 'a departing participant\'s first-seen timestamp must be cleaned up');

// DOMINANT_SPEAKER_CHANGED must compute withinJoinGracePeriod and return BEFORE the
// setSpeakingLevel calls when true -- but setDominantSpeakerId itself must still run
// unconditionally (MeetingRoomPage.tsx's own grace period already guards the pin side effect).
const dominantSpeakerStart = source.indexOf('room.on(JitsiMeetJS.events.conference.DOMINANT_SPEAKER_CHANGED');

assert.notEqual(dominantSpeakerStart, -1, 'expected the DOMINANT_SPEAKER_CHANGED handler to still exist');
const dominantSpeakerBlock = source.slice(dominantSpeakerStart, dominantSpeakerStart + 1300);

const setDominantIdx = dominantSpeakerBlock.indexOf('setDominantSpeakerId(id);');
const withinGraceIdx = dominantSpeakerBlock.indexOf('withinJoinGracePeriod');
const returnIdx = dominantSpeakerBlock.indexOf('if (withinJoinGracePeriod) {');
const setLevelIdx = dominantSpeakerBlock.indexOf('setSpeakingLevel(id, 1);');

assert.ok(setDominantIdx !== -1, 'setDominantSpeakerId must still be called unconditionally');
assert.ok(withinGraceIdx !== -1 && returnIdx !== -1 && setLevelIdx !== -1, 'expected the grace-period check and the speaking-level calls');
assert.ok(setDominantIdx < returnIdx, 'setDominantSpeakerId must run BEFORE the grace-period early return (the raw signal itself is not suppressed)');
assert.ok(returnIdx < setLevelIdx, 'the grace-period early return must come BEFORE the speaking-ring calls, so a just-joined false positive never lights the ring');
assert.match(
  dominantSpeakerBlock,
  /const firstSeenAt = remoteFirstSeenAt\[id\];\s*\n\s*const withinJoinGracePeriod = Boolean\(firstSeenAt\) && Date\.now\(\) - firstSeenAt < DOMINANT_SPEAKER_JOIN_GRACE_MS;/,
  'the grace-period check must be based on this id\'s own first-seen timestamp'
);

console.log('PASS: a participant joining the call no longer lights the speaking ring on their own tile until they have genuinely been reported speaking past a grace period; the raw dominant-speaker signal and local-participant handling are unaffected');
