const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real reported bug: the speaking ring could still show (or linger) while the mic was off, if
// there was background noise feeding the local level monitor or the remote per-track level
// listener at the moment of muting. Root cause: setSpeakingLevel(id, 0) -- the only thing the
// muted branches used to call -- does NOT clear the ring immediately; it only starts the hold
// timer counting down to clear (correct for a genuine brief pause mid-sentence, since
// speaking-ring-hold.test.cjs raised that hold to 1200ms). A muted track can never actually be
// producing real speech, so there's no "pause" to protect, and the hold must be bypassed
// entirely -- this is exactly what clearSpeaking() does (cancels any pending hold timer and sets
// the state to false immediately). Fixed in both the local level monitor/event listener
// (mediaHelpers.ts) and the remote per-track TRACK_AUDIO_LEVEL_CHANGED listener
// (useConferenceEvents.ts).
function loadSpeakingStore() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/speakingStore.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'react') return { useSyncExternalStore: () => undefined };
      throw new Error(`unexpected require: ${id}`);
    },
    setTimeout, clearTimeout,
  });

  return exports;
}

// Must stay >= speakingStore.ts's own SPEAKING_ONSET_DELAY_MS (300ms at time of writing) --
// sustaining a level past this is what actually flips the ring on in the first place (a separate,
// later onset-debounce feature; this file is about the HOLD/mute side, not onset).
const ONSET_WAIT_MS = 400;

test('#1 clearSpeaking clears the ring IMMEDIATELY, unlike setSpeakingLevel(id, 0) which only starts the hold countdown', async () => {
  const { setSpeakingLevel, clearSpeaking, isSpeakingNow } = loadSpeakingStore();

  setSpeakingLevel('p1', 0.5); // genuinely speaking
  await new Promise((resolve) => setTimeout(resolve, ONSET_WAIT_MS));
  assert.equal(isSpeakingNow('p1'), true, 'sanity: sustained speech must have turned the ring on after the onset delay');

  // The bug: setSpeakingLevel(id, 0) alone does NOT clear it synchronously.
  setSpeakingLevel('p1', 0);
  assert.equal(isSpeakingNow('p1'), true, 'sanity check: setSpeakingLevel(id, 0) must NOT clear synchronously (it starts a hold timer) -- this is the exact behavior the mute path must bypass');

  // The fix: clearSpeaking bypasses the hold entirely.
  setSpeakingLevel('p2', 0.5);
  await new Promise((resolve) => setTimeout(resolve, ONSET_WAIT_MS));
  assert.equal(isSpeakingNow('p2'), true);
  clearSpeaking('p2');
  assert.equal(isSpeakingNow('p2'), false, 'clearSpeaking must clear the ring synchronously, with no hold delay');
});

const mediaHelpersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'mediaHelpers.ts'), 'utf8');
const conferenceEventsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'jitsi', 'useConferenceEvents.ts'), 'utf8');

test('#2 mediaHelpers.ts: every muted branch of the local speaking-level machinery calls clearSpeaking, not setSpeakingLevel(_, 0)', () => {
  assert.match(mediaHelpersSource, /import \{ clearSpeaking, setSpeakingLevel \} from '\.\.\/speakingStore';/, 'clearSpeaking must be imported alongside setSpeakingLevel');

  // stopLocalLevelMonitor's own cleanup.
  const stopFnStart = mediaHelpersSource.indexOf('export function stopLocalLevelMonitor()');
  const stopFnBlock = mediaHelpersSource.slice(stopFnStart, stopFnStart + 200);

  assert.match(stopFnBlock, /clearSpeaking\('local'\);/, 'stopLocalLevelMonitor must clear instantly, not via setSpeakingLevel');

  // The 10x/second interval's own muted branch, inside startLocalLevelMonitor.
  const intervalMutedStart = mediaHelpersSource.indexOf('if (track.isMuted?.()) {');

  assert.notEqual(intervalMutedStart, -1, 'expected the interval\'s own muted check');
  const intervalMutedBlock = mediaHelpersSource.slice(intervalMutedStart, intervalMutedStart + 700);

  assert.match(intervalMutedBlock, /clearSpeaking\('local'\);/, 'the interval\'s muted branch must clear instantly');
  assert.doesNotMatch(intervalMutedBlock.slice(0, intervalMutedBlock.indexOf('return;')), /setSpeakingLevel\('local', 0\)/, 'must not still call the hold-respecting setSpeakingLevel(_, 0) in the muted branch');

  // attachLocalSpeaking's own 'track.audioLevelsChanged' listener.
  const attachFnStart = mediaHelpersSource.indexOf('export function attachLocalSpeaking');
  const attachFnBlock = mediaHelpersSource.slice(attachFnStart, attachFnStart + 500);

  assert.match(attachFnBlock, /if \(track\.isMuted\?\.\(\)\) \{\s*\n\s*clearSpeaking\('local'\);/, 'the audioLevelsChanged listener\'s muted branch must clear instantly, not via a ternary into setSpeakingLevel(_, 0)');
});

test('#3 useConferenceEvents.ts: the remote per-track TRACK_AUDIO_LEVEL_CHANGED listener calls clearSpeaking when muted', () => {
  const listenerStart = conferenceEventsSource.indexOf('TRACK_AUDIO_LEVEL_CHANGED');

  assert.notEqual(listenerStart, -1, 'expected the remote TRACK_AUDIO_LEVEL_CHANGED listener to still exist');
  const listenerBlock = conferenceEventsSource.slice(listenerStart, listenerStart + 600);

  assert.match(
    listenerBlock,
    /if \(track\.isMuted\(\)\) \{\s*\n\s*clearSpeaking\(participantId\);\s*\n\s*\} else \{\s*\n\s*setSpeakingLevel\(participantId, level\);/,
    'a muted remote track\'s level update must clear the ring instantly via clearSpeaking, not via the hold-respecting setSpeakingLevel(_, 0)'
  );
});

console.log('PASS: a muted mic (local or remote) clears the speaking ring instantly, bypassing the hold timer -- no more lingering/reappearing ring from background noise while muted');
