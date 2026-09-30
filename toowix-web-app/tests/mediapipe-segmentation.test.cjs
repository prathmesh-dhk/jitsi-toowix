const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real localStorage-backed and performance.now()-backed behaviour, not browser primitives, so
// this runs the actual compiled module rather than mocking around it.
function load(initialLocalStorage = {}, initialNow = 0, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36', { prod = false, search = '' } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/mediaPipeSegmentation.ts'), 'utf8');
  // vm.runInNewContext runs this as a plain script, where `import.meta` is a syntax error
  // regardless of guards around it -- same fix as tests/virtual-background.test.cjs uses.
  const patchedSource = source.replace(/import\.meta/g, `({env:{PROD:${prod}}})`);
  const code = ts.transpileModule(patchedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const store = { ...initialLocalStorage };
  const localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; }
  };
  let nowValue = initialNow;
  const performance = { now: () => nowValue };
  const navigator = { userAgent };
  const location = { search };
  const exports = {};

  vm.runInNewContext(code, { exports, localStorage, performance, navigator, location, URLSearchParams });

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

test('readSegmentationEngineOverride defaults to mediapipe-cpu on a mobile user agent (no GPU dependency)', () => {
  const androidUa = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
  const iosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  assert.equal(load({}, 0, androidUa).exports.readSegmentationEngineOverride(), 'mediapipe-cpu');
  assert.equal(load({}, 0, iosUa).exports.readSegmentationEngineOverride(), 'mediapipe-cpu');
  // An explicit override still wins over the mobile default -- a dev/test forcing 'v1' or
  // 'mediapipe-gpu' on a mobile UA for comparison purposes must not be silently ignored.
  assert.equal(load({ toowix_bg_engine: 'mediapipe-gpu' }, 0, androidUa).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
});

test('readSegmentationEngineOverride ignores an invalid/garbage stored value and falls back to the default', () => {
  assert.equal(load({ toowix_bg_engine: 'nonsense' }).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
  assert.equal(load({ toowix_bg_engine: '' }).exports.readSegmentationEngineOverride(), 'mediapipe-gpu');
});

test('readSegmentationEngineOverride does not throw if localStorage access itself throws (private mode)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/mediaPipeSegmentation.ts'), 'utf8');
  const patchedSource = source.replace(/import\.meta/g, '({env:{}})');
  const code = ts.transpileModule(patchedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
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

test('readMediaPipeSegSizeOverride: no override set returns null (caller uses its native 256x144 default)', () => {
  assert.equal(load().exports.readMediaPipeSegSizeOverride(), null);
});

test('readMediaPipeSegSizeOverride: respects a valid stored value', () => {
  assert.equal(load({ toowix_bg_seg_size: '256' }).exports.readMediaPipeSegSizeOverride(), 256);
  assert.equal(load({ toowix_bg_seg_size: '512' }).exports.readMediaPipeSegSizeOverride(), 512);
});

test('readMediaPipeSegSizeOverride: ignores an invalid stored value', () => {
  assert.equal(load({ toowix_bg_seg_size: '1080' }).exports.readMediaPipeSegSizeOverride(), null);
});

test('readMediaPipeSegSizeOverride: ?bgSegSize= URL param wins and is written through to localStorage', () => {
  const s = load({}, 0, undefined, { search: '?bgSegSize=256' });

  assert.equal(s.exports.readMediaPipeSegSizeOverride(), 256);
  assert.equal(s.localStorage.getItem('toowix_bg_seg_size'), '256');
});

test('readMediaPipeSegSizeOverride: forced to null in a production build, even with a valid override set', () => {
  assert.equal(load({ toowix_bg_seg_size: '256' }, 0, undefined, { prod: true }).exports.readMediaPipeSegSizeOverride(), null);
});
