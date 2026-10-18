const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real reported bug: the "speaking" ring/highlight flickered off and back on during completely
// normal speech -- any gap between words or sentences longer than the hold timer cleared it, and
// ordinary speech cadence regularly has pauses longer than the previous 500ms default. Neither
// the local mic level monitor (mediaHelpers.ts, samples 10x/second) nor the remote per-track
// TRACK_AUDIO_LEVEL_CHANGED listener (useConferenceEvents.ts) passes an explicit holdMs, so both
// silently relied on setSpeakingLevel's own default -- these tests exercise that default (and the
// hold mechanism itself) directly, independent of React, same vm-sandbox pattern as the other
// pure-logic test files in this suite.
function load() {
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

test('#1 setSpeakingLevel default hold is at least 1000ms (long enough to survive a normal mid-sentence pause)', async () => {
  const { setSpeakingLevel, isSpeakingNow } = load();

  setSpeakingLevel('p1', 0.5); // speaking, using the DEFAULT hold (no third argument)
  assert.equal(isSpeakingNow('p1'), true);
  setSpeakingLevel('p1', 0); // silence starts (e.g. a breath, a pause before the next word)

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(isSpeakingNow('p1'), true, 'a 700ms pause (longer than the old 500ms default) must NOT have cleared the speaking indicator');
});

test('#2 the ring still clears once someone has genuinely stopped talking past the hold window', async () => {
  const { setSpeakingLevel, isSpeakingNow } = load();

  setSpeakingLevel('p2', 0.5);
  assert.equal(isSpeakingNow('p2'), true);
  setSpeakingLevel('p2', 0);

  await new Promise((resolve) => setTimeout(resolve, 1400));
  assert.equal(isSpeakingNow('p2'), false, 'the indicator must still clear eventually -- this is a hold, not a permanent stick');
});

test('#3 repeated short silence/sound bursts within the hold window never clear the indicator (simulates natural word gaps)', async () => {
  const { setSpeakingLevel, isSpeakingNow } = load();

  for (let i = 0; i < 4; i += 1) {
    setSpeakingLevel('p3', 0.4); // a spoken word
    await new Promise((resolve) => setTimeout(resolve, 80));
    setSpeakingLevel('p3', 0); // the brief gap after it
    await new Promise((resolve) => setTimeout(resolve, 300)); // shorter than the hold window
    assert.equal(isSpeakingNow('p3'), true, `iteration ${i}: a short inter-word gap must not have cleared the indicator`);
  }
});

console.log('PASS speaking-ring hold: survives normal mid-speech pauses, still clears after genuine silence, never flickers during rapid word-gap bursts');
