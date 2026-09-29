const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real localStorage-backed and performance.now()-backed behaviour, not browser primitives, so
// this runs the actual compiled module rather than mocking around it.
function load(initialLocalStorage = {}, initialNow = 0) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/mediaPipeSegmentation.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const store = { ...initialLocalStorage };
  const localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; }
  };
  let nowValue = initialNow;
  const performance = { now: () => nowValue };
  const exports = {};

  vm.runInNewContext(code, { exports, localStorage, performance });

  return { exports, localStorage, setNow: (v) => { nowValue = v; } };
}

test('readSegmentationEngineOverride defaults to mediapipe-gpu with nothing set', () => {
  const { exports } = load();

  assert.equal(exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
});

test('readSegmentationEngineOverride respects a valid stored override', () => {
  assert.equal(load({ toowix_bg_engine: 'mediapipe-cpu' }).exports.readSegmentationEngineOverride(), 'mediapipe-cpu');
  assert.equal(load({ toowix_bg_engine: 'mediapipe-gpu' }).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
  assert.equal(load({ toowix_bg_engine: 'v1' }).exports.readSegmentationEngineOverride(), 'v1');
});

test('readSegmentationEngineOverride ignores an invalid/garbage stored value and falls back to the default', () => {
  assert.equal(load({ toowix_bg_engine: 'nonsense' }).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
  assert.equal(load({ toowix_bg_engine: '' }).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
});

test('readSegmentationEngineOverride does not throw if localStorage access itself throws (private mode)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/mediaPipeSegmentation.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, {
    exports,
    localStorage: { getItem() { throw new Error('SecurityError: access denied'); } },
    performance: { now: () => 0 }
  });
  assert.equal(exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
});

test('getNextMediaPipeTimestamp is monotonically increasing across calls at the same performance.now()', () => {
  const { exports, setNow } = load();

  setNow(1000);
  const first = exports.getNextMediaPipeTimestamp();
  const second = exports.getNextMediaPipeTimestamp(); // performance.now() unchanged -- must still increase

  assert.ok(second > first, `expected second (${second}) > first (${first})`);
});

test('getNextMediaPipeTimestamp tracks a genuinely advancing clock without just incrementing by 1 forever', () => {
  const { exports, setNow } = load();

  setNow(1000);
  const first = exports.getNextMediaPipeTimestamp();

  setNow(5000);
  const second = exports.getNextMediaPipeTimestamp();

  assert.equal(second, 5000, 'a real clock advance must be reflected, not overridden by the +1ms same-value guard');
  assert.ok(second > first);
});

test('getNextMediaPipeTimestamp never goes backwards even if performance.now() briefly reports an earlier value', () => {
  const { exports, setNow } = load();

  setNow(5000);
  const first = exports.getNextMediaPipeTimestamp();

  setNow(4000); // clock skew / a rare backwards jump
  const second = exports.getNextMediaPipeTimestamp();

  assert.ok(second > first, `expected second (${second}) > first (${first}) despite performance.now() going backwards`);
});
