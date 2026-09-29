const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(store = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/backgroundDebugTools.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const localStorage = { getItem: (key) => (key in store ? store[key] : null) };
  const exports = {};

  vm.runInNewContext(code, { exports, localStorage });

  return exports;
}

test('debug flags default to OFF', () => {
  const exports = load();

  assert.equal(exports.isMaskDebugEnabled(), false);
  assert.equal(exports.isOverlayDebugEnabled(), false);
});

test('debug flags turn on only with the exact string "1"', () => {
  assert.equal(load({ toowix_bg_debug_mask: '1' }).isMaskDebugEnabled(), true);
  assert.equal(load({ toowix_bg_debug_mask: 'true' }).isMaskDebugEnabled(), false);
  assert.equal(load({ toowix_bg_debug_mask: '0' }).isMaskDebugEnabled(), false);
  assert.equal(load({ toowix_bg_debug_overlay: '1' }).isOverlayDebugEnabled(), true);
});

test('debug flags do not throw if localStorage access itself throws', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/backgroundDebugTools.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, { exports, localStorage: { getItem() { throw new Error('denied'); } } });
  assert.equal(exports.isMaskDebugEnabled(), false);
  assert.equal(exports.isOverlayDebugEnabled(), false);
});

test('computeStats on an empty array returns all zeros instead of throwing', () => {
  const exports = load();
  const stats = exports.computeStats([]);

  assert.equal(stats.average, 0);
  assert.equal(stats.max, 0);
  assert.equal(stats.min, 0);
  assert.equal(stats.p95, 0);
});

test('computeStats: min/max/average are correct', () => {
  const exports = load();
  const stats = exports.computeStats([ 10, 20, 30, 40, 50 ]);

  assert.equal(stats.min, 10);
  assert.equal(stats.max, 50);
  assert.equal(stats.average, 30);
});

test('computeStats: p95 uses the nearest-rank method and is order-independent', () => {
  const exports = load();
  const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100, already interesting at p95=95
  const stats = exports.computeStats(samples);

  assert.equal(stats.p95, 95);

  const shuffled = [ ...samples ].reverse();
  const shuffledStats = exports.computeStats(shuffled);

  assert.equal(shuffledStats.average, stats.average, 'input order must not affect the result');
  assert.equal(shuffledStats.max, stats.max);
  assert.equal(shuffledStats.min, stats.min);
  assert.equal(shuffledStats.p95, stats.p95);
});

test('computeStats: a single sample returns that sample for every stat', () => {
  const exports = load();
  const stats = exports.computeStats([ 42 ]);

  assert.equal(stats.average, 42);
  assert.equal(stats.max, 42);
  assert.equal(stats.min, 42);
  assert.equal(stats.p95, 42);
});

test('roundTo1Decimal', () => {
  const exports = load();

  assert.equal(exports.roundTo1Decimal(1.23), 1.2);
  assert.equal(exports.roundTo1Decimal(1.26), 1.3);
  assert.equal(exports.roundTo1Decimal(0), 0);
});
