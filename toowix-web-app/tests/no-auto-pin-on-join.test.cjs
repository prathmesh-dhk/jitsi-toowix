const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: a participant joining the call immediately pinned the view onto them (a
// jarring switch from the grid to a solo stage, with a visible one-frame outline glitch from the
// abrupt view-structure change), even though nobody had spoken yet. Root cause: JVB's
// DOMINANT_SPEAKER_CHANGED can report a just-joined participant as dominant speaker before any
// real audio energy exists for them -- there's no "nobody is speaking yet" state it can report
// instead -- and the existing auto-follow-speaker effect trusted that unconditionally. The fix
// tracks each remote participant's first-seen timestamp and ignores a dominant-speaker report
// for anyone within REMOTE_JOIN_AUTO_PIN_GRACE_MS of first appearing, without touching the manual
// pin path (manuallyPinnedRef) or the local-participant case at all.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

assert.match(
  source,
  /const REMOTE_JOIN_AUTO_PIN_GRACE_MS = \d+;/,
  'expected a defined grace period constant for distrusting a just-joined participant\'s dominant-speaker report'
);
assert.match(
  source,
  /const remoteFirstSeenAtRef = useRef<Record<string, number>>\(\{\}\);/,
  'expected a ref tracking each remote participant\'s first-seen timestamp'
);

// The effect that maps jitsiMeeting.remoteParticipants into local state must populate
// remoteFirstSeenAtRef the first time each id appears, and prune ids that left.
const mapEffectStart = source.indexOf('const list = Object.values(jitsiMeeting.remoteParticipants);');

assert.notEqual(mapEffectStart, -1, 'expected the remote-participant mapping effect to still exist');
const mapEffectBlock = source.slice(mapEffectStart, mapEffectStart + 700);

assert.match(
  mapEffectBlock,
  /if \(!\(r\.id in remoteFirstSeenAtRef\.current\)\) \{\s*\n\s*remoteFirstSeenAtRef\.current\[r\.id\] = now;/,
  'must record a first-seen timestamp the first time each remote id appears, never overwriting it on subsequent updates'
);
assert.match(
  mapEffectBlock,
  /delete remoteFirstSeenAtRef\.current\[id\];/,
  'must prune a departed participant\'s first-seen timestamp so a later rejoin is treated as a fresh join, not stale state'
);

// The dominant-speaker auto-pin effect must consult the grace period for a REMOTE id only, after
// the existing manual-pin guard, before ever calling setPinnedParticipantId.
const autoPinEffectStart = source.indexOf('if (!jitsiMeeting.dominantSpeakerId) return;');

assert.notEqual(autoPinEffectStart, -1, 'expected the dominant-speaker auto-pin effect to still exist');
const autoPinEffectBlock = source.slice(autoPinEffectStart, autoPinEffectStart + 1300);

assert.match(autoPinEffectBlock, /if \(manuallyPinnedRef\.current\) return;/, 'the existing manual-pin guard must still run first, unaffected by this fix');
assert.match(
  autoPinEffectBlock,
  /if \(!isLocal\) \{\s*\n\s*const firstSeenAt = remoteFirstSeenAtRef\.current\[jitsiMeeting\.dominantSpeakerId\];\s*\n\s*\n\s*if \(firstSeenAt && Date\.now\(\) - firstSeenAt < REMOTE_JOIN_AUTO_PIN_GRACE_MS\) \{\s*\n\s*return;/,
  'a remote dominant-speaker report within the grace period of first joining must be ignored (no setPinnedParticipantId call), and this check must not apply to the local participant'
);
// Ensure the guard runs BEFORE the actual pin call, not after.
const guardIdx = autoPinEffectBlock.indexOf('REMOTE_JOIN_AUTO_PIN_GRACE_MS');
const setPinIdx = autoPinEffectBlock.indexOf('setPinnedParticipantId(isLocal');

assert.ok(guardIdx !== -1 && setPinIdx !== -1 && guardIdx < setPinIdx, 'the grace-period guard must run before setPinnedParticipantId is ever called');

console.log('PASS: a participant joining the call no longer auto-pins the stage onto them until they have genuinely been the dominant speaker past a grace period; manual pins and the local participant are unaffected');
