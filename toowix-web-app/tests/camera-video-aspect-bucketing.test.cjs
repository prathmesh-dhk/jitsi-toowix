const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// TOOWIX MEET mixed gallery -- regression tests for the receiver-side pure logic in
// videoOrientation.ts that feeds the mixed-aspect gallery layout (bucketAspectRatio,
// determineObjectFit), independent of the React hooks wrapped around them (same pattern as
// camera-orientation.test.cjs for networkQuality.ts).
function load() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/videoOrientation.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};

  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'react') {
        return {
          useState: (initial) => [ initial, () => {} ],
          useRef: (initial) => ({ current: initial }),
          useCallback: (fn) => fn,
        };
      }
      throw new Error(`unexpected require: ${id}`);
    }
  });

  return exports;
}

// #1 -- a real phone-portrait decode size snaps to the 9:16 bucket.
test('#1 bucketAspectRatio: a real 1080x1920 portrait decode snaps to 9:16', () => {
  const { bucketAspectRatio } = load();

  assert.equal(bucketAspectRatio(1080 / 1920), 9 / 16);
});

// #2 -- a real desktop-landscape decode size snaps to the 16:9 bucket (no regression: the
// existing, already-fixed desktop/MacBook landscape behavior must stay landscape).
test('#2 bucketAspectRatio: a real 1920x1080 landscape decode snaps to 16:9', () => {
  const { bucketAspectRatio } = load();

  assert.equal(bucketAspectRatio(1920 / 1080), 16 / 9);
});

// #3 -- a 4:3 webcam must be preserved as 4:3, not forced to the nearest 16:9/9:16 bucket -- the
// brief explicitly requires 4:3 streams keep their own shape, not get cropped into 16:9.
test('#3 bucketAspectRatio: a 4:3 webcam (640x480-style) snaps to 4:3, preserved rather than cropped to 16:9', () => {
  const { bucketAspectRatio } = load();

  assert.equal(bucketAspectRatio(4 / 3), 4 / 3);
});

// #4 -- a perfectly square stream snaps to 1:1 rather than being arbitrarily pushed toward either
// landscape or portrait.
test('#4 bucketAspectRatio: a square stream (1:1) stays square, not biased toward landscape', () => {
  const { bucketAspectRatio } = load();

  assert.equal(bucketAspectRatio(1), 1);
});

// #5 -- small jitter around a real camera's ratio (refocus, exposure, simulcast layer swap) must
// not cross into a different bucket -- this is what prevents the layout from reflowing every
// frame (the exact resize-flicker class of bug this app has already been fixed for once).
test('#5 bucketAspectRatio: small jitter around a real landscape ratio stays in the 16:9 bucket', () => {
  const { bucketAspectRatio } = load();
  const nominal = 1920 / 1080;

  for (const jitter of [ -0.01, -0.002, 0, 0.002, 0.01 ]) {
    assert.equal(bucketAspectRatio(nominal + jitter), 16 / 9, `jitter ${jitter} must not escape the 16:9 bucket`);
  }
});

// #6 -- invalid/unknown dimensions (0, negative, NaN) must fall back to the safe 16:9 default
// rather than producing a broken card shape or propagating NaN into the layout math.
test('#6 bucketAspectRatio: unknown/invalid input (0, negative, NaN) safely defaults to 16:9', () => {
  const { bucketAspectRatio } = load();

  for (const bad of [ 0, -1, NaN, Infinity, -Infinity ]) {
    assert.equal(bucketAspectRatio(bad), 16 / 9, `input ${bad} must default to 16:9, never NaN/0/negative`);
  }
});

// #7 -- determineObjectFit is untouched by this change: still 'contain' for portrait, 'cover' for
// landscape, matching the already-shipped "Option A" behavior exactly.
test('#7 determineObjectFit: unchanged -- contain for portrait, cover for landscape/square', () => {
  const { determineObjectFit } = load();

  assert.equal(determineObjectFit(1080, 1920), 'contain');
  assert.equal(determineObjectFit(1920, 1080), 'cover');
  assert.equal(determineObjectFit(1000, 1000), 'cover');
});

// #8 -- DEFAULT_CAMERA_VIDEO_ASPECT is exactly the ordinary gallery default (16:9, cover) -- this
// is the camera-off / not-yet-bound fallback the product decision requires.
test('#8 DEFAULT_CAMERA_VIDEO_ASPECT is the ordinary 16:9/cover default (camera-off fallback)', () => {
  const { DEFAULT_CAMERA_VIDEO_ASPECT } = load();

  assert.equal(DEFAULT_CAMERA_VIDEO_ASPECT.ratio, 16 / 9);
  assert.equal(DEFAULT_CAMERA_VIDEO_ASPECT.objectFit, 'cover');
});

// #9 -- bindCameraVideoAspectListener reports the fit and the bucketed ratio TOGETHER from a
// single update, so a component can never see them land on different frames (consistency between
// the card's own reshaping and its video's object-fit).
test('#9 bindCameraVideoAspectListener: one call reports BOTH objectFit and ratio together for a given frame', () => {
  const { bindCameraVideoAspectListener } = load();
  const listeners = {};
  const fakeVideo = {
    videoWidth: 1080,
    videoHeight: 1920,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: () => {},
  };
  const seen = [];

  bindCameraVideoAspectListener(fakeVideo, (info) => seen.push(info));

  assert.equal(seen.length, 1, 'the initial call (covering an already-available stream) must fire exactly once');
  assert.equal(seen[0].objectFit, 'contain');
  assert.equal(seen[0].ratio, 9 / 16);

  fakeVideo.videoWidth = 1920;
  fakeVideo.videoHeight = 1080;
  listeners.resize();

  const last = seen[seen.length - 1];

  assert.equal(last.objectFit, 'cover', 'a live resize event (phone rotation) must update the fit');
  assert.equal(last.ratio, 16 / 9, 'a live resize event (phone rotation) must update the ratio in the SAME call as the fit');
});

console.log('PASS camera video aspect bucketing: real decode sizes snap to stable canonical shapes, jitter-resistant, safe defaults, fit+ratio always reported together');
