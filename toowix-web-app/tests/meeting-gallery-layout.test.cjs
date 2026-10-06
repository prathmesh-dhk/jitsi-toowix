const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Loads src/lib/meetingLayout.ts with a controllable React stub, so the real hook can be driven through
// render / commit cycles without a DOM.
function load() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/meetingLayout.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  const react = {
    slots: [],
    cursor: 0,
    effects: [],
    useRef(initial) {
      const index = react.cursor++;

      react.slots[index] ||= { current: initial };

      return react.slots[index];
    },
    useLayoutEffect(effect) {
      react.effects.push(effect);
    },
  };

  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'react') return react;
      throw new Error(`unexpected require: ${id}`);
    },
  });

  // One render of a component that calls the hook. `commit` runs the layout effects, as React does after a
  // committed render. A render that is never committed (Strict Mode double render, a discarded retry) must
  // not change the next decision.
  const render = (input) => {
    react.cursor = 0;
    react.effects = [];
    const result = exports.useStableMeetingLayout(input);

    return { result, commit: () => react.effects.forEach((effect) => effect()) };
  };
  const reset = () => { react.slots = []; react.cursor = 0; react.effects = []; };

  return { ...exports, render, reset };
}

// Every card must sit inside the stage, cards must not overlap, and each row must be centred on its own.
function assertPlacement(count, layout, width, height, gap) {
  const positions = load().calculateCellPositions(count, layout, width, height, gap);

  assert.equal(positions.length, count);
  positions.forEach(({ left, top }) => {
    assert.ok(left >= -0.01 && top >= -0.01, `cell starts inside the stage: ${left},${top}`);
    assert.ok(left + layout.cardWidth <= width + 0.01, `cell right edge stays in the stage: ${left}+${layout.cardWidth} > ${width}`);
    assert.ok(top + layout.cardHeight <= height + 0.01, `cell bottom edge stays in the stage: ${top}+${layout.cardHeight} > ${height}`);
  });

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = positions[i];
      const b = positions[j];
      const overlap = a.left < b.left + layout.cardWidth && b.left < a.left + layout.cardWidth
        && a.top < b.top + layout.cardHeight && b.top < a.top + layout.cardHeight;

      assert.equal(overlap, false, `cells ${i} and ${j} overlap`);
    }
  }

  const rows = new Map();

  positions.forEach((p) => rows.set(p.top, [ ...(rows.get(p.top) || []), p ]));
  assert.equal(rows.size, layout.rows, 'rendered rows match the selected structure');
  rows.forEach((rowCells) => {
    assert.ok(rowCells.length <= layout.columns, 'no row holds more cards than the selected columns');
    const leftMargin = Math.min(...rowCells.map((c) => c.left));
    const rightMargin = width - Math.max(...rowCells.map((c) => c.left + layout.cardWidth));

    assert.ok(Math.abs(leftMargin - rightMargin) <= 0.51, `row is centred: left ${leftMargin}, right ${rightMargin}`);
  });

  return positions;
}

test('calculateCellPositions: rows match the structure and an incomplete final row is centred', () => {
  const { calculateMeetingLayout } = load();
  // 665x646 is the measured stage of the real gallery at a 701px-wide window (see tests/meeting-gallery-browser.cjs).
  const layout = calculateMeetingLayout({ participantCount: 3, width: 665, height: 646, mode: 'gallery', sidePanelOpen: false, gap: 12 });
  const positions = assertPlacement(3, layout, 665, 646, 12);

  assert.equal(layout.columns, 2, 'test setup: three cards in this measured stage settle into two columns');
  assert.equal(layout.rows, 2);
  const lastRowAlone = positions[2];

  assert.ok(Math.abs(lastRowAlone.left - (665 - layout.cardWidth) / 2) <= 0.51, 'the lone card of the last row is centred');
});

test('calculateCellPositions: placement holds for many counts and stage sizes', () => {
  const { calculateMeetingLayout } = load();
  const sizes = [[320, 480], [700, 800], [1280, 800], [1600, 900], [980, 420], [1920, 1080]];

  for (const count of [1, 2, 3, 4, 6, 9, 10, 12, 15, 16, 20, 24, 30, 35, 42]) {
    for (const [width, height] of sizes) {
      const layout = calculateMeetingLayout({ participantCount: count, width, height, mode: 'gallery', sidePanelOpen: false, gap: 12 });

      assertPlacement(count, layout, width, height, 12);
    }
  }
});

test('calculator fallback: a very small stage still returns a structure that fits without overflow', () => {
  const { calculateMeetingLayout } = load();
  const sizes = [[60, 60], [120, 90], [200, 140], [260, 200]];

  for (const count of [2, 3, 5, 8]) {
    for (const [width, height] of sizes) {
      const layout = calculateMeetingLayout({ participantCount: count, width, height, mode: 'gallery', sidePanelOpen: false, gap: 12 });
      const usedWidth = layout.columns * layout.cardWidth + (layout.columns - 1) * 12;
      const usedHeight = layout.rows * layout.cardHeight + (layout.rows - 1) * 12;

      assert.ok(usedWidth <= width + 0.5, `${count} cards at ${width}x${height}: width ${usedWidth} overflows`);
      assert.ok(usedHeight <= height + 0.5, `${count} cards at ${width}x${height}: height ${usedHeight} overflows`);
    }
  }
});

test('mobile tile pages: 4+ participants always use a two-column structure of at most eight tiles', () => {
  const { calculateMeetingLayout } = load();
  const mobileStage = { width: 360, height: 640, mode: 'gallery', sidePanelOpen: false, gap: 12, forceColumns: 2 };

  // 3 deliberately has no forceColumns in production; it retains the established layout path.
  const three = calculateMeetingLayout({ ...mobileStage, participantCount: 3, forceColumns: undefined });
  assert.notEqual(three.columns, undefined, 'the unmodified 1-3 calculator remains available');

  for (const count of [4, 5, 6, 7, 8]) {
    const layout = calculateMeetingLayout({ ...mobileStage, participantCount: count });

    assert.equal(layout.columns, 2, `${count} tiles use two columns`);
    assert.equal(layout.rows, Math.ceil(count / 2), `${count} tiles use the expected row count`);
    assert.ok(Math.abs(layout.columns * layout.cardWidth + (layout.columns - 1) * 12 - mobileStage.width) <= 0.5,
      `${count} tiles fill the mobile stage width`);
    assert.ok(Math.abs(layout.rows * layout.cardHeight + (layout.rows - 1) * 12 - mobileStage.height) <= 0.5,
      `${count} tiles fill the mobile stage height`);
    assertPlacement(count, layout, mobileStage.width, mobileStage.height, 12);
  }

  // The second page of a 9-tile gallery contains one tile, but is still a two-column page.
  const remainder = calculateMeetingLayout({ ...mobileStage, participantCount: 1 });
  assert.equal(remainder.columns, 2, 'a short final page retains two-column sizing');
  assert.equal(remainder.rows, 1, 'a one-tile final page has one row');
  assertPlacement(1, remainder, mobileStage.width, mobileStage.height, 12);
});

test('hook: a render that is never committed does not change the next decision (Strict Mode double render)', () => {
  const lib = load();
  const input = { participantCount: 3, width: 1400, height: 800, mode: 'gallery', sidePanelOpen: false, gap: 12 };
  const first = lib.render(input); first.commit();

  const shrink = { ...input, width: 760 };
  const discarded = lib.render(shrink); // rendered, never committed
  const retried = lib.render(shrink); // the retry sees the same committed state as the discarded render

  assert.deepEqual(retried.result, discarded.result, 'a retry computes the same structure');
  retried.commit();
});

test('hook: a participant-count change discards the hold, so a join or leave re-fits at once', () => {
  const lib = load();
  const three = { participantCount: 3, width: 1400, height: 800, mode: 'gallery', sidePanelOpen: false, gap: 12 };
  const seated = lib.render(three); seated.commit();

  const four = lib.render({ ...three, participantCount: 4, width: 1400 });
  const expected = lib.calculateMeetingLayout({ ...three, participantCount: 4, width: 1400 });

  assert.deepEqual(four.result, expected, 'after a count change the layout equals the fresh best fit');
});

test('hook: within one count, the held structure survives small moves (hysteresis)', () => {
  const lib = load();
  const input = { participantCount: 3, width: 1500, height: 800, mode: 'gallery', sidePanelOpen: false, gap: 12, ratios: ['16:9'] };
  const held = lib.render(input); held.commit();
  const nudged = lib.render({ ...input, width: 1499 });

  assert.equal(nudged.result.columns, held.result.columns, 'a one-pixel move keeps the column count');
});

test('hook: a monotonic drag shrinks and expands the structure without reversing on a single step', () => {
  const lib = load();
  const base = { participantCount: 3, height: 800, mode: 'gallery', sidePanelOpen: false, gap: 12 };
  const structures = [];
  const widths = [];

  for (let w = 1400; w >= 420; w -= 1) widths.push(w);
  for (let w = 420; w <= 1400; w += 1) widths.push(w);
  for (const width of widths) {
    const frame = lib.render({ ...base, width });

    frame.commit();
    structures.push(`${frame.result.columns}x${frame.result.rows}`);
  }

  const half = widths.indexOf(420);
  const shrink = structures.slice(0, half + 1);
  const expand = structures.slice(half);
  const columnsOf = (key) => Number(key.split('x')[0]);
  const monotone = (seq, decreasing) => seq.every((key, i) => i === 0
    || (decreasing ? columnsOf(key) <= columnsOf(seq[i - 1]) : columnsOf(key) >= columnsOf(seq[i - 1])));

  assert.ok(monotone(shrink, true), 'shrinking never adds columns back');
  assert.ok(monotone(expand, false), 'expanding never removes columns');

  for (let i = 1; i < structures.length - 1; i += 1) {
    const reversed = structures[i] !== structures[i - 1] && structures[i + 1] === structures[i - 1];

    assert.equal(reversed, false, `no one-step reversal at width ${widths[i]}`);
  }
});

console.log('PASS meeting gallery placement, fallback, and hook behaviour');
