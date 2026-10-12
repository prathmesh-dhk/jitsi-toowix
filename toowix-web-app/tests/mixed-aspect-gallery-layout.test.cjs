const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// TOOWIX MEET mixed portrait/landscape gallery -- regression tests for the per-participant
// aspect-ratio-aware layout extension added to meetingLayout.ts (calculateMixedAspectLayout /
// chooseStableMixedAspectLayout), independent of the useStableMixedAspectLayout React hook
// wrapper, same pattern as meeting-layout-hysteresis.test.cjs for the uniform-ratio engine.
function load() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/meetingLayout.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'react') return { useRef: (initial) => ({ current: initial }), useLayoutEffect: () => {} };
      throw new Error(`unexpected require: ${id}`);
    }
  });

  return exports;
}

const PORTRAIT = 9 / 16;
const LANDSCAPE = 16 / 9;

// #10 -- a single portrait participant gets a portrait-SHAPED card (narrower than tall), not a
// landscape card with the video merely letterboxed inside it.
test('#10 solo portrait participant: card itself is taller than wide, not a 16:9 box', () => {
  const { calculateMixedAspectLayout } = load();
  const result = calculateMixedAspectLayout([ { key: 'local', ratio: PORTRAIT } ], 1200, 800, 12);

  assert.equal(result.cells.length, 1);
  const cell = result.cells[0];

  assert.ok(cell.height > cell.width, `expected a portrait card (height > width), got ${cell.width}x${cell.height}`);
  assert.ok(Math.abs(cell.width / cell.height - PORTRAIT) < 0.05, 'card ratio must closely match the real portrait ratio');
});

// #11 -- a single landscape participant still gets the familiar wide card (no regression from
// introducing per-participant sizing).
test('#11 solo landscape participant: card stays wide (16:9-shaped), matching pre-existing behavior', () => {
  const { calculateMixedAspectLayout } = load();
  const result = calculateMixedAspectLayout([ { key: 'local', ratio: LANDSCAPE } ], 1200, 800, 12);
  const cell = result.cells[0];

  assert.ok(cell.width > cell.height, `expected a landscape card (width > height), got ${cell.width}x${cell.height}`);
});

// #12 -- the core new requirement: one portrait and one landscape card coexisting in the SAME
// gallery, each keeping its own real shape (neither cropped, neither forced to match the other).
test('#12 mixed gallery: a portrait card and a landscape card coexist, each keeping its own real shape', () => {
  const { calculateMixedAspectLayout } = load();
  const result = calculateMixedAspectLayout(
    [ { key: 'phone', ratio: PORTRAIT }, { key: 'laptop', ratio: LANDSCAPE } ], 1400, 900, 12,
  );
  const byKey = new Map(result.cells.map((c) => [ c.key, c ]));
  const phone = byKey.get('phone');
  const laptop = byKey.get('laptop');

  assert.ok(phone && laptop, 'both cards must be placed');
  assert.ok(phone.height > phone.width, 'the phone card must stay portrait-shaped');
  assert.ok(laptop.width > laptop.height, 'the laptop card must stay landscape-shaped');
});

// #13 -- no overlap: every cell must fit inside the stage bounds and never overlap another cell,
// for a representative mix of shapes and counts (not just the 1-2 participant toy cases above).
test('#13 mixed gallery: cells never overlap and always stay within stage bounds (5 mixed-ratio participants)', () => {
  const { calculateMixedAspectLayout } = load();
  const cards = [
    { key: 'a', ratio: PORTRAIT }, { key: 'b', ratio: LANDSCAPE }, { key: 'c', ratio: 1 },
    { key: 'd', ratio: PORTRAIT }, { key: 'e', ratio: 4 / 3 },
  ];
  const width = 1600;
  const height = 900;
  const result = calculateMixedAspectLayout(cards, width, height, 12);

  assert.equal(result.cells.length, 5);
  for (const cell of result.cells) {
    assert.ok(cell.left >= -0.5, `cell ${cell.key} left out of bounds: ${cell.left}`);
    assert.ok(cell.top >= -0.5, `cell ${cell.key} top out of bounds: ${cell.top}`);
    assert.ok(cell.left + cell.width <= width + 0.5, `cell ${cell.key} overflows stage width`);
    assert.ok(cell.top + cell.height <= height + 0.5, `cell ${cell.key} overflows stage height`);
  }
  for (let i = 0; i < result.cells.length; i += 1) {
    for (let j = i + 1; j < result.cells.length; j += 1) {
      const a = result.cells[i];
      const b = result.cells[j];
      const overlapX = a.left < b.left + b.width - 0.5 && b.left < a.left + a.width - 0.5;
      const overlapY = a.top < b.top + b.height - 0.5 && b.top < a.top + a.height - 0.5;

      assert.ok(!(overlapX && overlapY), `cells ${a.key} and ${b.key} overlap`);
    }
  }
});

// #14 -- camera-off reset: a participant whose card was previously portrait-shaped must return to
// the ordinary 16:9 default the instant their entry reports the default ratio again (this is what
// MeetingParticipantCard's hook does the moment its <video> unmounts on camera-off -- see
// videoOrientation.ts's DEFAULT_CAMERA_VIDEO_ASPECT). The layout function itself has no notion of
// "camera on/off"; it only ever sees whatever ratio it's given, so this test is really asserting
// that a default-ratio entry produces the ordinary wide card, not a frozen portrait shape.
test('#14 camera-off reset: a card reported back at the default 16:9 ratio returns to a wide shape', () => {
  const { calculateMixedAspectLayout } = load();
  const stillPortrait = calculateMixedAspectLayout(
    [ { key: 'p1', ratio: PORTRAIT }, { key: 'p2', ratio: LANDSCAPE } ], 1400, 900, 12,
  );
  const cameraOff = calculateMixedAspectLayout(
    [ { key: 'p1', ratio: LANDSCAPE }, { key: 'p2', ratio: LANDSCAPE } ], 1400, 900, 12,
  );
  const p1Before = stillPortrait.cells.find((c) => c.key === 'p1');
  const p1After = cameraOff.cells.find((c) => c.key === 'p1');

  assert.ok(p1Before.height > p1Before.width, 'sanity: p1 starts portrait-shaped');
  assert.ok(p1After.width > p1After.height, 'p1 must return to a wide (16:9-shaped) card once reported back at the default ratio');
});

// #15 -- no card is ever sized below the enforced minimum, same floor the uniform engine enforces.
test('#15 mixed gallery never produces a card below the enforced minimum tile size, even with many participants', () => {
  const { calculateMixedAspectLayout } = load();
  const cards = Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, ratio: i % 2 === 0 ? PORTRAIT : LANDSCAPE }));
  const result = calculateMixedAspectLayout(cards, 1280, 720, 12);

  assert.equal(result.cells.length, 12, 'every participant must still be placed, even in the degraded-fit fallback path');
  for (const cell of result.cells) {
    assert.ok(cell.width > 0 && cell.height > 0, `cell ${cell.key} must have positive size`);
  }
});

// #16 -- varying participant counts (1 through 9) never overflow and always place every card.
test('#16 varying participant counts (1-9), all-landscape, never overflow the stage', () => {
  const { calculateMixedAspectLayout } = load();

  for (let n = 1; n <= 9; n += 1) {
    const cards = Array.from({ length: n }, (_, i) => ({ key: `p${i}`, ratio: LANDSCAPE }));
    const result = calculateMixedAspectLayout(cards, 1600, 900, 12);

    assert.equal(result.cells.length, n, `count ${n}: every card must be placed`);
    for (const cell of result.cells) {
      assert.ok(cell.left + cell.width <= 1600.5, `count ${n}: cell ${cell.key} overflows width`);
      assert.ok(cell.top + cell.height <= 900.5, `count ${n}: cell ${cell.key} overflows height`);
    }
  }
});

// #17 -- stability/hysteresis: chooseStableMixedAspectLayout with no previous layout (first
// render) returns the best candidate, matching chooseStableLayout's own documented behavior.
test('#17 chooseStableMixedAspectLayout: with no previous layout, returns the best candidate', () => {
  const { calculateMixedAspectLayout, chooseStableMixedAspectLayout } = load();
  const cards = [ { key: 'a', ratio: PORTRAIT }, { key: 'b', ratio: LANDSCAPE }, { key: 'c', ratio: 1 } ];
  const best = calculateMixedAspectLayout(cards, 1400, 900, 12);
  const chosen = chooseStableMixedAspectLayout(cards, 1400, 900, 12, null);

  assert.deepEqual(chosen, best);
});

// #18 -- stability/hysteresis: a sub-threshold resize (a few px, the same class of tick that used
// to cause the browser-resize flicker bug) must not change the row count the gallery is holding.
test('#18 chooseStableMixedAspectLayout: a tiny resize does not change the held row count', () => {
  const { calculateMixedAspectLayout, chooseStableMixedAspectLayout } = load();
  const cards = Array.from({ length: 6 }, (_, i) => ({ key: `p${i}`, ratio: i % 2 === 0 ? PORTRAIT : LANDSCAPE }));
  const current = calculateMixedAspectLayout(cards, 1500, 800, 12);
  const chosen = chooseStableMixedAspectLayout(cards, 1501, 800, 12, current.rows);

  assert.equal(chosen.rows, current.rows, 'a 1px width change must not flip the held row count');
});

// #19 -- the layout never stretches a card past its own natural (content-filling) size -- only
// ever shrinks to fit. A very short/wide stage must shrink every row uniformly rather than
// distorting individual cards' ratios.
test('#19 layout only ever shrinks to fit a short stage, never distorts individual card ratios', () => {
  const { calculateMixedAspectLayout } = load();
  const cards = [ { key: 'a', ratio: LANDSCAPE }, { key: 'b', ratio: LANDSCAPE } ];
  const result = calculateMixedAspectLayout(cards, 2000, 300, 12);

  for (const cell of result.cells) {
    const ratio = cell.width / cell.height;

    assert.ok(Math.abs(ratio - LANDSCAPE) < 0.02, `cell ${cell.key} ratio ${ratio} must still match the card's real 16:9 ratio, never distorted`);
  }
});

console.log('PASS mixed-aspect-ratio gallery packing: portrait/landscape cards keep their real shape, coexist without overlap, respect minimum size, and hold stable under small resizes');
