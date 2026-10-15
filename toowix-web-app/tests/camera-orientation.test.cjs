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

// UPDATED: a live side-by-side test against stock Jitsi Meet's own web client (same device, same
// browser) showed that swapping width/height and forcing an aspectRatio constraint made no
// difference to what the camera actually delivered -- mobile portrait capture is now an
// explicitly out-of-scope problem for this web client (a native app is the planned fix), and the
// capture request is identical regardless of how the phone is held, matching stock Jitsi's own
// plain resolution request (no orientation swap, no aspectRatio hint at all).
test('phone: iPhone UA is "phone" -- requests the same landscape-shaped ideal as a tablet, no orientation swap', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(IPHONE_SAFARI);

  assert.equal(getCameraDeviceCategory(), 'phone');
  const ideal = getCameraCaptureIdeal();

  assert.ok(ideal.width > ideal.height, 'phone ideal is landscape-shaped (width > height), same as desktop/tablet');
  assert.equal(JSON.stringify(ideal), JSON.stringify({ frameRate: 30, height: 1080, width: 1920 }));
});

test('phone: Android phone UA (has the "Mobile" token) is "phone", same ideal regardless of orientation', () => {
  const { getCameraDeviceCategory, getCameraCaptureIdeal } = load(ANDROID_PHONE);

  assert.equal(getCameraDeviceCategory(), 'phone');
  assert.ok(getCameraCaptureIdeal().width > getCameraCaptureIdeal().height);
});

test('phone and tablet request the literal SAME ideal (not just the same pixel count) -- device category only, no orientation distinction', () => {
  const phoneIdeal = load(IPHONE_SAFARI).getCameraCaptureIdeal();
  const tabletIdeal = load(IPAD_SAFARI_LEGACY).getCameraCaptureIdeal();

  assert.equal(phoneIdeal.width, tabletIdeal.width);
  assert.equal(phoneIdeal.height, tabletIdeal.height);
});

test('constraints: desktop, tablet and phone all request a plain resolution -- no aspectRatio or advanced field at all', () => {
  const desktop = load(DESKTOP_CHROME_MAC).getPreferredCameraCaptureConstraints();
  const tablet = load(IPAD_SAFARI_LEGACY).getPreferredCameraCaptureConstraints();
  const phone = load(IPHONE_SAFARI).getPreferredCameraCaptureConstraints();

  for (const constraints of [ desktop, tablet, phone ]) {
    assert.equal(constraints.aspectRatio, undefined);
    assert.equal(constraints.advanced, undefined);
  }
});

test('constraints: width/height/frameRate stay "ideal"-only, so an unsupported resolution can never throw OverconstrainedError over it', () => {
  const { getPreferredCameraCaptureConstraints } = load(DESKTOP_CHROME_MAC);
  const constraints = getPreferredCameraCaptureConstraints();

  assert.ok('ideal' in constraints.width);
  assert.ok('ideal' in constraints.height);
  assert.ok('ideal' in constraints.frameRate);
  assert.equal(Object.keys(constraints.width).length, 1, 'width must carry no min/max/exact alongside ideal that could make the request fail');
  assert.equal(Object.keys(constraints.height).length, 1, 'height must carry no min/max/exact alongside ideal that could make the request fail');
});

test('constraints: the SAME request is sent regardless of device category -- only the resolution tier (phone/tablet vs desktop) differs', () => {
  for (const nav of [ DESKTOP_CHROME_MAC, IPAD_SAFARI_LEGACY, IPHONE_SAFARI ]) {
    const { getPreferredCameraCaptureConstraints } = load(nav);
    const c = getPreferredCameraCaptureConstraints();

    assert.deepEqual(Object.keys(c).sort(), [ 'frameRate', 'height', 'width' ], `UA "${nav.userAgent}" must request only width/height/frameRate`);
  }
});

console.log('PASS camera device-category detection and the shared capture-constraint builder');
