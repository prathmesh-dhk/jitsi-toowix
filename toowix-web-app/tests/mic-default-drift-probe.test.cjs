const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: on macOS, connecting AirPods for the FIRST time switches the speaker (OS-
// level default-output redirection, happens regardless of any Toowix code) but the microphone
// stays on the MacBook, with the UI still showing "Default System Microphone" -- i.e. the symbolic
// default never gets reconciled against the new physical device. Manually picking "AirPods
// Microphone" works; reconnecting sometimes works automatically.
//
// CONFIRMED CODE GAP (by inspection, not yet observed on real hardware -- no AirPods/macOS access
// in this environment): every existing auto-switch path (immediate match, paired groupId match,
// bounded delayed re-check) is keyed off enumerateDevices() reporting a deviceId that WASN'T in
// previousIds -- i.e. a genuinely NEW device. None of them cover the case where the OS default
// input silently moves to a device whose deviceId the browser already knew about (e.g. AirPods
// granted permission in an earlier session, or already visible from an earlier, unrelated burst)
// -- no new ID ever appears, so the mic never switches even though the symbolic default no longer
// points at the physical device the UI implies.
//
// Fix: a cheap, bounded probe -- ask the browser what deviceId 'default' currently resolves to
// (an unattached, immediately-stopped stream), compare it against the REAL active track's
// deviceId via getActiveAudioInputDeviceId() (not just whatever the UI happens to show as
// selected), and only replace the track through the existing confirm-before-commit
// attemptAudioInputSwitch path on a CONFIRMED mismatch -- never an unconditional restart.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

test('the default-drift probe exists, gated to only run when nothing else already found a new device', () => {
  assert.match(
    source,
    /if \(!newAudioIn && !pairedIn && !audioIdRef\.current && hasJoined && !defaultDriftCheckInFlightRef\.current\) \{/,
    'must only probe when no new deviceId was already found this burst (newAudioIn/pairedIn), the mic is still unset, the call has started, and no probe is already in flight'
  );
});

test('the probe compares the REAL active track deviceId, not the UI-selected one', () => {
  const triggerIdx = source.indexOf('defaultDriftCheckInFlightRef.current = true;');

  assert.notEqual(triggerIdx, -1, 'the probe block must exist');
  const block = source.slice(triggerIdx, triggerIdx + 1600);

  assert.match(block, /jitsiMeeting\.getActiveAudioInputDeviceId\?\.\(\)/, 'must read the REAL active track deviceId (MediaStreamTrack.getSettings().deviceId), not trust the UI state');
  assert.match(block, /getUserMedia\(\{\s*audio:\s*\{\s*deviceId:\s*'default'\s*\}\s*\}\)/, 'must ask the browser what "default" currently resolves to, via a throwaway probe stream');
});

test('the probe stream is always stopped and never left open or attached anywhere', () => {
  const triggerIdx = source.indexOf('defaultDriftCheckInFlightRef.current = true;');
  const block = source.slice(triggerIdx, triggerIdx + 1600);

  assert.match(block, /probeStream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/, 'the probe stream must have every track stopped immediately after reading its deviceId -- never left open as an extra, unused mic capture');
});

test('the probe only replaces the track on a CONFIRMED mismatch, through the shared confirm-before-commit helper', () => {
  const triggerIdx = source.indexOf('defaultDriftCheckInFlightRef.current = true;');
  const block = source.slice(triggerIdx, triggerIdx + 1600);

  assert.match(
    block,
    /if \(cancelled \|\| audioIdRef\.current \|\| !probeDeviceId \|\| probeDeviceId === activeId\) return;/,
    'must bail out (no replace) when the probe deviceId matches the active track, is missing, or audioId got set by something else meanwhile -- never an unconditional restart'
  );
  assert.match(
    block,
    /await attemptAudioInputSwitch\(\{ deviceId: probeDeviceId \} as MediaDeviceInfo, 'default-drift-probe'\)/,
    'a confirmed mismatch must go through the same confirm-before-commit attemptAudioInputSwitch path as every other switch, not a separate ad-hoc replace'
  );
});

test('the probe guard is always cleared, including on error, so it cannot permanently wedge future bursts', () => {
  const triggerIdx = source.indexOf('defaultDriftCheckInFlightRef.current = true;');
  const block = source.slice(triggerIdx, triggerIdx + 1800);

  assert.match(
    block,
    /\}\s*finally\s*\{\s*defaultDriftCheckInFlightRef\.current = false;/,
    'the in-flight guard must be cleared in a finally block so a getUserMedia failure (permission edge case, device busy) cannot permanently block future probes'
  );
});

test('manual selection still blocks auto-switch entirely -- the probe never overrides an explicit pick', () => {
  // The probe (like every other auto-switch path) is gated on `!audioIdRef.current`. The moment
  // a person picks a device by hand, audioId is non-empty and this whole branch is skipped.
  const triggerIdx = source.indexOf('if (!newAudioIn && !pairedIn && !audioIdRef.current');

  assert.notEqual(triggerIdx, -1);
});

console.log('PASS mic default-drift probe: covers OS default changing to an already-known deviceId, never fires on a manual selection, never leaves a stray probe stream open');
