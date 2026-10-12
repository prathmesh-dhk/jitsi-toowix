const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Real reported bug: on macOS Chrome, the camera came in portrait on the FIRST join of a
// meeting but correctly landscape after a rejoin. Root cause: the lobby preview and the in-call
// path built their own, separately-drifting getUserMedia constraints; first join actually runs
// on the ADOPTED lobby stream, not a freshly-acquired one, so whichever constraint builder was
// "better" never reached the stream that mattered. getCameraDeviceCategory/
// getPreferredCameraCaptureConstraints in networkQuality.ts are the single shared source both
// paths now use -- these tests exercise that logic directly, independent of the React hooks
// wrapped around it (same pattern as meeting-layout-hysteresis.test.cjs).
function load(navigatorOverrides) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/networkQuality.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  const context = { exports, navigator: navigatorOverrides };

  vm.runInNewContext(code, context);

  return exports;
}

const DESKTOP_CHROME_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' };
const IPAD_SAFARI_LEGACY = { userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5 };
// Modern iPadOS Safari reports its UA as plain "Macintosh" -- real multi-touch is the only thing
// that actually tells it apart from a real Mac, which has maxTouchPoints 0.
const IPADOS_AS_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5 };
const ANDROID_TABLET = { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', maxTouchPoints: 10 };
const IPHONE_SAFARI = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5 };
const ANDROID_PHONE = { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36', maxTouchPoints: 5 };

test('desktop: Mac Chrome is "desktop", prefers 4K landscape', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(DESKTOP_CHROME_MAC);

  assert.equal(getCameraDeviceCategory(), 'desktop');
  const ideal = getCameraCaptureIdeal();

  assert.ok(ideal.width > ideal.height, 'desktop ideal must be landscape (width > height)');
  assert.equal(JSON.stringify(ideal), JSON.stringify({ frameRate: 30, height: 2160, width: 3840 }));
});

test('tablet: legacy iPad UA is "tablet", not "phone" -- prefers 1080p landscape', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(IPAD_SAFARI_LEGACY);

  assert.equal(getCameraDeviceCategory(), 'tablet');
  const ideal = getCameraCaptureIdeal();

  assert.ok(ideal.width > ideal.height, 'tablet ideal must be landscape (width > height)');
  assert.equal(JSON.stringify(ideal), JSON.stringify({ frameRate: 30, height: 1080, width: 1920 }));
});

test('tablet: modern iPadOS spoofing "Macintosh" is still correctly detected as tablet via real multi-touch', () => {
  const { getCameraDeviceCategory } = load(IPADOS_AS_MAC);

  assert.equal(getCameraDeviceCategory(), 'tablet', 'maxTouchPoints > 1 on a "Macintosh" UA must not be misread as a real Mac');
});

test('tablet: Android tablet (no "Mobile" token in UA) is "tablet", not "phone"', () => {
  const { getCameraDeviceCategory } = load(ANDROID_TABLET);

  assert.equal(getCameraDeviceCategory(), 'tablet');
});

test('phone: iPhone UA is "phone" -- prefers portrait capture, not landscape', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(IPHONE_SAFARI);

  assert.equal(getCameraDeviceCategory(), 'phone');
  const ideal = getCameraCaptureIdeal();

  assert.ok(ideal.height > ideal.width, 'phone ideal must be portrait (height > width), matching how someone actually holds a phone for a call');
  assert.equal(JSON.stringify(ideal), JSON.stringify({ frameRate: 30, height: 1920, width: 1080 }));
});

test('phone: Android phone UA (has the "Mobile" token) is "phone", prefers portrait', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(ANDROID_PHONE);

  assert.equal(getCameraDeviceCategory(), 'phone');
  assert.ok(getCameraCaptureIdeal().height > getCameraCaptureIdeal().width);
});

test('phone and tablet keep the SAME total pixel count as before this fix (only reoriented, never reduced)', () => {
  const phoneIdeal = load(IPHONE_SAFARI).getCameraCaptureIdeal();
  const tabletIdeal = load(IPAD_SAFARI_LEGACY).getCameraCaptureIdeal();

  assert.equal(phoneIdeal.width * phoneIdeal.height, 1080 * 1920);
  assert.equal(tabletIdeal.width * tabletIdeal.height, 1920 * 1080);
});

test('constraints: desktop/tablet request a 16:9 aspect ratio, phone requests 9:16', () => {
  const desktop = load(DESKTOP_CHROME_MAC).getPreferredCameraCaptureConstraints();
  const tablet = load(IPAD_SAFARI_LEGACY).getPreferredCameraCaptureConstraints();
  const phone = load(IPHONE_SAFARI).getPreferredCameraCaptureConstraints();

  assert.equal(desktop.aspectRatio.ideal, 16 / 9);
  assert.equal(tablet.aspectRatio.ideal, 16 / 9);
  assert.equal(phone.aspectRatio.ideal, 9 / 16);
});

test('constraints: the aspectRatio preference is NEVER a bare/mandatory constraint -- only "ideal" and "advanced", so an unsupported resolution can never throw OverconstrainedError over it', () => {
  const { getPreferredCameraCaptureConstraints } = load(DESKTOP_CHROME_MAC);
  const constraints = getPreferredCameraCaptureConstraints();

  assert.equal(typeof constraints.aspectRatio, 'object', 'aspectRatio must be an object ({ ideal: ... }), never a bare number (which getUserMedia treats as a hard requirement)');
  assert.ok('ideal' in constraints.aspectRatio);
  assert.ok(Array.isArray(constraints.advanced), 'advanced must be an array -- the UA tries each entry and silently skips any it cannot satisfy, never failing the whole request');
  assert.equal(constraints.advanced.length, 1);
  // width/height/frameRate must likewise stay "ideal"-only -- a camera that only offers lower
  // resolutions (an "unsupported" request) must still return SOME track, not OverconstrainedError.
  assert.ok('ideal' in constraints.width);
  assert.ok('ideal' in constraints.height);
  assert.ok('ideal' in constraints.frameRate);
  assert.equal(Object.keys(constraints.width).length, 1, 'width must carry no min/max/exact alongside ideal that could make the request fail');
  assert.equal(Object.keys(constraints.height).length, 1, 'height must carry no min/max/exact alongside ideal that could make the request fail');
});

test('constraints: the ideal width/height and the ideal/advanced aspectRatio always agree with each other (no internally-contradictory request)', () => {
  for (const nav of [ DESKTOP_CHROME_MAC, IPAD_SAFARI_LEGACY, IPHONE_SAFARI ]) {
    const { getPreferredCameraCaptureConstraints } = load(nav);
    const c = getPreferredCameraCaptureConstraints();
    const widthOverHeight = c.width.ideal > c.height.ideal;
    const aspectOverOne = c.aspectRatio.ideal > 1;

    assert.equal(widthOverHeight, aspectOverOne, `width/height orientation must match the requested aspectRatio for UA "${nav.userAgent}"`);
    assert.equal(c.advanced[0].aspectRatio, c.aspectRatio.ideal, 'the advanced fallback must request the SAME ratio as the ideal, not a second, possibly-different number');
  }
});

console.log('PASS camera device-category detection and the shared capture-constraint builder');
