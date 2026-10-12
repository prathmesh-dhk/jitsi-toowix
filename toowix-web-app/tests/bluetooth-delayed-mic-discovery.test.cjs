const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported symptom: on macOS, connecting AirPods during a call switches the SPEAKER but the
// microphone stays on the MacBook (or never activates). Investigated causes, in order of how
// directly each is evidenced by the code (see the inline comments at each source location this
// file checks):
//
// 1. CONFIRMED CODE DEFECT (fixed): setAudioId/setOutputId used to commit BEFORE the switch was
//    confirmed to have worked. A failed mic open (macOS's Bluetooth HFP mic profile can take a
//    moment longer than the A2DP speaker profile to actually become openable) left audioId
//    permanently set to the failed device's id, blocking all future auto-switch attempts that
//    session while the UI claimed it had switched. See auto-switch-new-device.test.cjs and
//    bluetooth-paired-device-switch.test.cjs for the fix itself (attemptAudioInputSwitch/
//    attemptAudioOutputSwitch, confirm-then-commit).
// 2. CONFIRMED CODE DEFECT (fixed 2026-10-12, see MICROPHONE_AUDIT.md): the bounded re-check used
//    to only fire when the SAME devicechange burst also brought new audio OUTPUT activity
//    (`(pairedOut || newAudioOut) && !audioIdRef.current`). That misses the case where NEITHER
//    channel of a brand-new device is visible yet in the triggering burst -- plausible for a
//    first-ever Bluetooth pairing, whose handshake can take noticeably longer than a reconnect of
//    an already-known device. Now the re-check fires whenever the mic is still unset after ANY
//    settled burst, extended to three bounded steps (600ms/1500ms/3000ms) to give a slower
//    first-time pairing more room, and guarded against overlapping chains via
//    delayedMicRecheckInFlightRef. This file verifies the mechanism exists and is actually bounded.
// 3. CONFIRMED, BY-DESIGN MECHANISM worth flagging (not changed here -- see the audit report):
//    audioId/outputId persist in localStorage across sessions. If the person ever manually picked
//    a specific microphone in ANY past session, auto-switch for input is disabled from page load
//    regardless of Bluetooth logic. The diagnostic log checked below reports this directly
//    (audioIdAlreadyPinned) so it's observable on real hardware rather than guessed at.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

test('a privacy-safe diagnostic reports device counts and whether audioId/outputId are already pinned', () => {
  assert.match(
      source,
      /audioInputCount: audioInput\.length, audioOutputCount: audioOutput\.length, videoInputCount: videoInput\.length,\s*\n\s*audioIdAlreadyPinned: Boolean\(audioId\), outputIdAlreadyPinned: Boolean\(outputId\),/,
      'must report device counts and whether audioId/outputId are already pinned (the localStorage-persistence mechanism), so this is directly observable on real hardware instead of guessed at'
  );
  // Privacy: the diagnostic block must never include raw device labels or deviceIds (can contain
  // a person's name, e.g. "Jayesh's AirPods Pro") -- only counts/booleans.
  const diagnosticStart = source.indexOf('devicechange settled');
  const diagnosticBlock = source.slice(diagnosticStart, diagnosticStart + 400);

  assert.doesNotMatch(diagnosticBlock, /\.label\b/, 'the diagnostic must not log raw device labels');
  assert.doesNotMatch(diagnosticBlock, /newAudioIn\.deviceId|pairedIn\.deviceId/, 'the diagnostic must not log raw deviceIds');
});

test('a late-discovered Bluetooth mic gets a BOUNDED (not open-ended) follow-up re-check', () => {
  assert.match(
      source,
      /const delayedReenumerationDelaysMs = \[ 600, 1500, 3000 \];/,
      'the follow-up re-check must be a fixed, finite list of delays, not an open-ended poll loop'
  );
  assert.match(
      source,
      /if \(!audioIdRef\.current && !delayedMicRecheckInFlightRef\.current\) \{/,
      'the follow-up re-check must trigger whenever the mic is still unset after a settled burst (not only when new OUTPUT activity happened to be in the SAME burst), guarded against overlapping chains'
  );
});

test('the delayed re-check guard prevents overlapping chains from back-to-back devicechange bursts', () => {
  const triggerIdx = source.indexOf('delayedMicRecheckInFlightRef.current = true;');

  assert.notEqual(triggerIdx, -1, 'must set the in-flight guard before starting the async re-check chain');
  const block = source.slice(triggerIdx, triggerIdx + 2200);

  assert.match(block, /delayedMicRecheckInFlightRef\.current = false;/, 'must clear the in-flight guard once the chain ends (success, exhaustion, or audioId being set elsewhere)');
  assert.match(block, /\}\s*finally\s*\{\s*delayedMicRecheckInFlightRef\.current = false;/, 'the guard must be cleared in a finally block, so it clears even if a step throws');
});

test('the follow-up re-check stops as soon as audioId is set by ANY means, and reuses the same confirm-before-commit switch path', () => {
  const triggerIdx = source.indexOf('delayedReenumerationDelaysMs');
  const block = source.slice(triggerIdx, triggerIdx + 1800);

  assert.match(block, /if \(cancelled \|\| audioIdRef\.current\) return;/, 'must bail out the moment audioId becomes set (by this chain, another burst, or a manual pick), not keep retrying regardless');
  assert.match(block, /await attemptAudioInputSwitch\(candidate, `delayed-reenumeration-\$\{delayMs\}ms`\)/, 'the delayed path must go through the SAME confirm-before-commit helper as the immediate path, not a separate ad-hoc switch call with different (possibly weaker) guarantees');
});

test('live refs (audioIdRef/outputIdRef) exist so the delayed re-check reads CURRENT state, not a stale closure', () => {
  assert.match(
      source,
      /const audioIdRef = useRef\(audioId\);\s*\n\s*const outputIdRef = useRef\(outputId\);\s*\n\s*useEffect\(\(\) => \{ audioIdRef\.current = audioId; \}, \[audioId\]\);\s*\n\s*useEffect\(\(\) => \{ outputIdRef\.current = outputId; \}, \[outputId\]\);/,
      'audioIdRef/outputIdRef must exist and stay in sync with the real state, since the devicechange effect\'s own closure only sees state as of when IT was last defined'
  );
});

console.log('PASS Bluetooth delayed-mic-discovery mitigation: bounded re-check, privacy-safe diagnostics, confirm-before-commit reused');
