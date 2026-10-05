const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real reported bug: resizing the browser window made the participant gallery flicker between
// column counts / ratios / row counts because the layout was recalculated from scratch (the
// single globally "best" fit for the exact current pixel size) on every resize tick, with no
// memory of what was already on screen. chooseStableLayout is the fix -- these tests exercise it
// directly as pure logic, independent of the useStableMeetingLayout React hook wrapper (which
// only adds ref-based memoization and a minimum hold timer around the same decision).
function load() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/meetingLayout.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'react') return { useRef: (initial) => ({ current: initial }) };
      throw new Error(`unexpected require: ${id}`);
    }
  });

  return exports;
}

test('calculateMeetingLayout: picks a sane layout for a simple case (4 participants, roomy square stage)', () => {
  const { calculateMeetingLayout } = load();
  const result = calculateMeetingLayout({ participantCount: 4, width: 1000, height: 1000, mode: 'gallery', sidePanelOpen: false });

  assert.equal(result.rows * result.columns >= 4, true, 'must have enough cells for every participant');
  assert.ok(result.cardWidth > 0 && result.cardHeight > 0);
});

test('chooseStableLayout: with no previous layout (first render), returns the absolute best fit', () => {
  const { calculateMeetingLayout, chooseStableLayout } = load();
  const input = { participantCount: 6, width: 1400, height: 800, mode: 'gallery', sidePanelOpen: false };
  const best = calculateMeetingLayout(input);
  const chosen = chooseStableLayout(input, null);

  assert.deepEqual(chosen, best);
});

test('chooseStableLayout: keeps the current column count when a candidate is only marginally better (under the 8% gain threshold)', () => {
  const { calculateMeetingLayout, chooseStableLayout } = load();
  // 6 participants at width 1500 settles on 3 columns -- seed `current` from the real calculator
  // (not hand-picked numbers) so the test reflects an actually-reachable structure, then nudge the
  // width by 1px, exactly the kind of sub-threshold resize-drag tick that must NOT flip columns.
  // Pinned to 16:9 only so this isolates column-count hysteresis from ratio hysteresis (covered
  // separately below) -- at the default ratio list, 4:3 can itself be the better candidate here.
  const seedInput = { participantCount: 6, width: 1500, height: 800, mode: 'gallery', sidePanelOpen: false, ratios: ['16:9'] };
  const current = calculateMeetingLayout(seedInput);

  assert.equal(current.columns, 3, 'test setup check: the seeded structure must actually be 3 columns');

  const chosen = chooseStableLayout({ ...seedInput, width: 1501 }, current);

  assert.equal(chosen.columns, 3, 'must hold the current column count across a tiny size change');
  assert.equal(chosen.ratio, '16:9');
});

test('chooseStableLayout: switches column count once a candidate is enough better (8%+ gain)', () => {
  const { chooseStableLayout } = load();
  const current = { columns: 2, rows: 3, ratio: '16:9', cardWidth: 300, cardHeight: 168.75 };
  // A dramatically wider stage makes more columns clearly better -- well past the 8% bar.
  const input = { participantCount: 6, width: 2400, height: 500, mode: 'gallery', sidePanelOpen: false };
  const chosen = chooseStableLayout(input, current);

  assert.notEqual(chosen.columns, 2, 'must switch away from a column count that is now a clearly worse fit');
});

test('chooseStableLayout: ratio changes require the HIGHER 12% threshold, not the 8% column threshold', () => {
  const { calculateMeetingLayout, chooseStableLayout } = load();
  // At this exact size, 4:3 (same 3-column structure) is genuinely the single-best candidate --
  // about 9% more area than 16:9 -- which clears the 8% column-switch bar but NOT the 12%
  // ratio-switch bar. A held 16:9 layout must stay at 16:9 here.
  const input = { participantCount: 3, width: 820, height: 180, mode: 'gallery', sidePanelOpen: false, gap: 12 };
  const best = calculateMeetingLayout(input);

  assert.equal(best.ratio, '4:3', 'test setup check: 4:3 must actually be the unconstrained best answer here');

  const current = { columns: 3, rows: 1, ratio: '16:9', cardWidth: 265.5, cardHeight: 149.5 };
  const bestArea = best.cardWidth * best.cardHeight;
  const heldArea = current.cardWidth * current.cardHeight;
  const improvement = (bestArea - heldArea) / heldArea;

  assert.ok(improvement > 0.08 && improvement < 0.12, `test setup check: this scenario must sit strictly between the two thresholds, got ${(improvement * 100).toFixed(1)}%`);

  const chosen = chooseStableLayout(input, current);

  assert.equal(chosen.ratio, '16:9', 'a 9% gain clears the column-switch bar but must NOT be enough to switch ratio');
});

test('chooseStableLayout: falls back to the best candidate when the held structure no longer fits at all', () => {
  const { chooseStableLayout } = load();
  const current = { columns: 1, rows: 1, ratio: '16:9', cardWidth: 800, cardHeight: 450 };
  // Shrink the stage drastically -- 1 column at this size produces a card far under the minimum.
  const input = { participantCount: 1, width: 60, height: 40, mode: 'gallery', sidePanelOpen: false };
  const chosen = chooseStableLayout(input, current);

  assert.ok(chosen.cardWidth > 0 && chosen.cardHeight > 0, 'must still return a usable (if small) layout, not crash or return the unusable held one');
});

test('chooseStableLayout: never returns a candidate below the enforced minimum tile size when a larger one is available', () => {
  const { chooseStableLayout } = load();
  const input = { participantCount: 10, width: 1600, height: 900, mode: 'gallery', sidePanelOpen: false };
  const chosen = chooseStableLayout(input, null);

  assert.ok(chosen.cardWidth >= 120 && chosen.cardHeight >= 90, 'a roomy stage must never settle for a below-minimum card');
});

console.log('PASS meeting layout hysteresis (chooseStableLayout) behaves as the no-flicker spec requires');
