const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual effect with browser primitives mocked; not an iPhone rendering test.
// `engine` selects which ISegmentationEngineHandle shape the constructor gets ('v1' by default,
// matching every pre-Phase-2 test's behaviour unchanged); `mediaPipe` configures the mock
// segmenter's segmentForVideo() behaviour for MediaPipe-engine tests (maskWidth/maskHeight/
// values/throwOnSegment/noMask); `v1Fallback` configures what _fallBackToV1's on-demand TFLite
// load resolves/rejects with.
function setup(filter = true, { width = 640, height = 360, engine = 'v1', mediaPipe = {}, v1Fallback = {}, onGiveUp = null, isMobileDevice: isMobileDeviceFlag = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts'), 'utf8');
  // vm.runInNewContext runs this as a plain (non-module) script, where `import.meta` is a syntax
  // error regardless of guards around it -- Vite itself statically replaces import.meta.env.PROD
  // with a literal boolean before shipping; this mirrors that same replacement (with `false`,
  // i.e. "not a production build", so the dev-only governor time-scale override is honoured in
  // these tests, same as it would be in a real dev/test Vite build).
  const patchedSource = source.replace(/import\.meta/g, '({env:{}})');
  const code = ts.transpileModule(patchedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const draws = [];
  const warnings = [];
  const textOverlayCalls = [];
  const makeContext = () => ({
    ...(filter ? { filter: 'none' } : {}),
    drawImage: (...args) => draws.push(args),
    putImageData() {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    fillRect: (...args) => textOverlayCalls.push([ 'fillRect', ...args ]),
    fillText: (...args) => textOverlayCalls.push([ 'fillText', ...args ]),
    // Used by _fillSpatialHoles' scratch canvas (see JitsiStreamBackgroundEffect.ts) -- missing
    // here initially, which meant every MediaPipe test silently hit a real TypeError inside
    // _blendMaskValues, caught by _runMediaPipeInference's try/catch and reported as a FAILED
    // frame even though segmentation itself succeeded. Existing tests didn't catch this because
    // none of them asserted on the frame's success/failure return value or on whether
    // runPostProcessing was actually called -- only the new stale-mask-skip regression tests
    // added alongside this fix did, which is what surfaced this mock gap.
    clearRect() {}
  });
  let plays = 0;
  let rvfcCallback = null;
  let rvfcNextHandle = 1;
  const video = {
    readyState: 2, videoWidth: width, videoHeight: height, setAttribute() {}, pause() {},
    play() { plays++; return Promise.resolve(); },
    // Mirrors the real requestVideoFrameCallback/cancelVideoFrameCallback contract closely enough
    // for tests: stores the single pending callback (the effect only ever has one in flight) and
    // hands back an incrementing handle id (0 is a valid handle, so production code must never
    // treat it as falsy -- tests exercise that by starting the counter at 1 anyway for clarity).
    requestVideoFrameCallback(cb) { rvfcCallback = cb; return rvfcNextHandle++; },
    cancelVideoFrameCallback() { rvfcCallback = null; }
  };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement(kind) {
      if (kind === 'video') return video;
      if (kind === 'img') {
        let src = '';

        return {
          complete: true, naturalWidth: 640,
          get src() { return src; },
          set src(v) { src = v; },
          hasAttribute: (name) => name === 'src' && src !== '',
          removeAttribute: (name) => { if (name === 'src') src = ''; },
          getAttribute: (name) => (name === 'src' ? src : null)
        };
      }
      const context = makeContext();
      return { width: 0, height: 0, getContext: () => context, captureStream: () => ({ canvas: true }) };
    }
  });
  const window = new EventTarget();
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, enabled: true, getSettings: () => ({ width, height, frameRate: 30 }) });

  const mediaPipeCalls = { segmentForVideo: 0, close: 0, timestamps: [] };
  const mediaPipeSegmenter = {
    segmentForVideo: (videoEl, timestamp) => {
      mediaPipeCalls.segmentForVideo++;
      mediaPipeCalls.timestamps.push(timestamp);
      if (mediaPipe.throwOnSegment) {
        throw new Error('simulated MediaPipe segmentForVideo failure');
      }
      if (mediaPipe.noMask) {
        return { confidenceMasks: [] };
      }
      const maskWidth = mediaPipe.maskWidth ?? 4;
      const maskHeight = mediaPipe.maskHeight ?? 3;
      const values = mediaPipe.values ?? new Float32Array(maskWidth * maskHeight).fill(0.7);
      const mask = {
        width: maskWidth,
        height: maskHeight,
        getAsFloat32Array: () => {
          if (mediaPipe.throwOnReadback) {
            throw new Error('simulated MediaPipe getAsFloat32Array failure');
          }

          return values;
        },
        close: () => { mediaPipeCalls.close++; }
      };

      return { confidenceMasks: [ mask ] };
    }
  };

  let mediaPipeTimestampCounter = 0;
  let maskDebugFlag = false;
  let overlayDebugFlag = false;
  const loadV1FallbackCalls = [];
  const loadV1Fallback = () => {
    loadV1FallbackCalls.push(true);
    if (v1Fallback.reject) {
      return Promise.reject(new Error('simulated V1 fallback load failure'));
    }

    return Promise.resolve({ tflite: v1Fallback.tflite ?? {} });
  };

  const exports = {};

  // Phase 2 (Virtual Background & PiP Performance Audit): mocks src/lib/virtualBackground/
  // backgroundImageCache.ts. A real cache hit resolves synchronously (as the real module's
  // getCachedBackgroundImage does); anything else stays pending until a test explicitly calls
  // s.resolveImageLoad(src)/s.rejectImageLoad(src), the same "control the async boundary by hand"
  // pattern the MediaPipe segmenter mock above already uses for its own async-shaped calls.
  const imageCache = new Map(); // src -> ready <img> mock
  const pendingImageLoads = new Map(); // src -> { promise, resolve, reject }
  let imageDecodeStarts = 0;

  function makeReadyImageMock(src) {
    const img = document.createElement('img');

    img.src = src;

    return img;
  }

  // Phase 4: the stall watchdog's setInterval is deliberately NOT a real recurring timer in this
  // harness -- a real 4s-recurring interval per `setup()` call would leak across hundreds of test
  // invocations in the same process and could keep `node --test` from ever exiting. Tests that
  // need to exercise the watchdog's own logic call s.effect._checkForStall() directly instead
  // (same "control the async/timed boundary by hand" pattern the image-cache mock above and the
  // governor's fake-clock tests already use) -- nothing in this file relies on it actually firing
  // on a real wall-clock schedule.
  let fakeIntervalHandle = 1;

  vm.runInNewContext(code, {
    exports, document, window, console: { warn: (...args) => warnings.push(args), debug() {}, info() {} },
    setTimeout, clearTimeout,
    setInterval: () => fakeIntervalHandle++,
    clearInterval: () => {},
    // The SAME Date reference as the host realm (not vm's own) -- so a test's `Date.now = () =>
    // fakeNow` monkeypatch on the host's Date actually affects code running inside this vm
    // context too. Without this, vm.runInNewContext's own separate Date class means the patch
    // silently never reaches the governor's Date.now() calls (a real cross-realm gotcha,
    // discovered by the Phase 3 governor's fake-clock tests failing with real Date.now() values).
    Date,
    require: (id) => {
      if (id === './mediaPipeSegmentation') {
        return {
          getNextMediaPipeTimestamp: () => ++mediaPipeTimestampCounter, readMediaPipeSegSizeOverride: () => null,
          // Desktop by default, matching every pre-existing test's assumption (document.hidden
          // also defaults to false here) -- the Phase 1 hidden-tab-freeze fix scopes the
          // document.hidden check to mobile only, so this must be a real function, not undefined.
          isMobileDevice: () => isMobileDeviceFlag
        };
      }
      if (id === './backgroundDebugTools') {
        // Real math (needed if a test explicitly flips the flags below to exercise the debug
        // draw paths), flags default OFF exactly like the real localStorage-backed versions do
        // with nothing set -- so every pre-Phase-2b test is unaffected unless it opts in.
        return {
          isMaskDebugEnabled: () => maskDebugFlag,
          isOverlayDebugEnabled: () => overlayDebugFlag,
          computeStats: (samples) => {
            if (!samples.length) return { average: 0, max: 0, min: 0, p95: 0 };
            const sorted = [ ...samples ].sort((a, b) => a - b);
            const sum = sorted.reduce((total, value) => total + value, 0);
            const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

            return { average: sum / sorted.length, max: sorted[sorted.length - 1], min: sorted[0], p95: sorted[p95Index] };
          },
          roundTo1Decimal: (value) => Math.round(value * 10) / 10
        };
      }
      if (id === './backgroundImageCache') {
        return {
          getCachedBackgroundImage: (src) => imageCache.get(src) || null,
          preloadBackgroundImage: (src) => {
            if (!src) return Promise.reject(new Error('No background image source provided'));

            const cached = imageCache.get(src);

            if (cached) return Promise.resolve(cached);

            const existing = pendingImageLoads.get(src);

            if (existing) return existing.promise;

            imageDecodeStarts++;
            let resolveFn;
            let rejectFn;
            const promise = new Promise((resolve, reject) => {
              resolveFn = resolve;
              rejectFn = reject;
            });

            pendingImageLoads.set(src, {
              promise,
              resolve: () => {
                const img = makeReadyImageMock(src);

                imageCache.set(src, img);
                pendingImageLoads.delete(src);
                resolveFn(img);
              },
              reject: (error) => {
                pendingImageLoads.delete(src);
                rejectFn(error instanceof Error ? error : new Error(String(error)));
              }
            });

            return promise;
          }
        };
      }

      return { SET_TIMEOUT: 1, CLEAR_TIMEOUT: 2, TIMEOUT_TICK: 3, timerWorkerScript: '' };
    },
    ImageData: class { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); } },
    Worker: class { messages = []; postMessage(message) { this.messages.push(message); } terminate() {} }
  });

  const engineHandle = engine === 'v1'
    ? { engine: 'v1', tflite: {} }
    : { engine, mediaPipeSegmenter };

  const effect = new exports.default(engineHandle, { backgroundType: 'blur', blurValue: 25 }, loadV1Fallback, onGiveUp);

  effect.startEffect({ getVideoTracks: () => [track] });

  return {
    effect, track, document, window, draws, video, warnings, plays: () => plays, mediaPipeCalls, loadV1FallbackCalls, textOverlayCalls,
    setMaskDebug: (v) => { maskDebugFlag = v; },
    setOverlayDebug: (v) => { overlayDebugFlag = v; },
    // Fires the currently-pending requestVideoFrameCallback, simulating a new camera frame.
    triggerVideoFrame: () => { if (rvfcCallback) rvfcCallback(); },
    // Phase 2 background-image-cache mock controls (see the './backgroundImageCache' require()
    // case above) -- let a test decide exactly when a pending "decode" finishes/fails, the same
    // way the MediaPipe segmenter mock is configured up front rather than actually timing anything.
    seedImageCache: (src) => { imageCache.set(src, makeReadyImageMock(src)); },
    hasPendingImageLoad: (src) => pendingImageLoads.has(src),
    resolveImageLoad: (src) => {
      const pending = pendingImageLoads.get(src);

      if (!pending) throw new Error(`No pending image load for ${src} -- did preloadBackgroundImage ever get called with this exact src?`);
      pending.resolve();
    },
    rejectImageLoad: (src, message) => {
      const pending = pendingImageLoads.get(src);

      if (!pending) throw new Error(`No pending image load for ${src} -- did preloadBackgroundImage ever get called with this exact src?`);
      pending.reject(new Error(message || 'simulated image load failure'));
    },
    getImageDecodeStarts: () => imageDecodeStarts
  };
}

// Flushes microtasks so a test can observe the result of a .then()/.catch() chain (e.g.
// setVirtualBackground's preloadBackgroundImage(...).then(...)) without any real async timing.
function flushMicrotasks() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

test('resumes on foreground and camera unmute; removes listeners on stop without stopping camera', () => {
  const s = setup();
  assert.equal(s.plays(), 1);
  s.document.hidden = true;
  s.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.plays(), 1);
  s.document.hidden = false;
  s.document.dispatchEvent(new Event('visibilitychange'));
  s.track.dispatchEvent(new Event('unmute'));
  s.window.dispatchEvent(new Event('pageshow'));
  assert.equal(s.plays(), 4);
  s.effect.stopEffect();
  s.document.dispatchEvent(new Event('visibilitychange'));
  s.track.dispatchEvent(new Event('unmute'));
  assert.equal(s.plays(), 4);
  assert.equal(s.track.readyState, 'live');
  assert.equal(s.video.srcObject, null);
});

test('does not segment muted, disabled, or ended camera frames (every platform)', () => {
  const s = setup();
  let frames = 0;
  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.track.muted = true;
  s.effect._renderMask();
  s.track.muted = false;
  s.track.enabled = false;
  s.effect._renderMask();
  s.track.enabled = true;
  s.track.readyState = 'ended';
  s.effect._renderMask();
  assert.equal(frames, 0);
  s.track.readyState = 'live';
  s.effect._renderMask();
  assert.equal(frames, 1);
});

// Phase 1 fix (Virtual Background & PiP Performance Audit): the blanket `document.hidden` stop
// condition froze segmentation/compositing on EVERY platform whenever the main/opener tab was
// hidden -- but since that canvas's captureStream() feeds both PiP and the real outgoing WebRTC
// video, this froze what other participants saw too, on desktop browsers where a hidden tab does
// not actually stop the camera from delivering real new frames. The fix scopes the document.hidden
// stop condition to isMobileDevice() only, preserving the original (real, documented) mobile OS
// camera-suspension protection while letting desktop keep processing live frames in the
// background.
test('desktop: a hidden tab alone does NOT stop processing -- only a genuinely muted/disabled/ended track does', () => {
  const s = setup(true, { isMobileDevice: false });
  let frames = 0;

  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.document.hidden = true;
  s.effect._renderMask();
  assert.equal(frames, 1, 'a hidden tab must not block processing on desktop -- freezing here would also freeze PiP and the outgoing WebRTC video for every other participant');
  s.track.muted = true;
  s.effect._renderMask();
  assert.equal(frames, 1, 'a genuinely muted track must still stop processing on desktop, hidden tab or not');
});

test('mobile: a hidden tab still stops processing, preserving the original OS camera-suspension protection', () => {
  const s = setup(true, { isMobileDevice: true });
  let frames = 0;

  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.document.hidden = true;
  s.effect._renderMask();
  assert.equal(frames, 0, 'mobile devices keep the original protection against real OS-level camera suspension while backgrounded');
  s.document.hidden = false;
  s.effect._renderMask();
  assert.equal(frames, 1, 'once visible again, mobile processing resumes normally');
});

test('uses background-only blur fallback without Canvas2D.filter', () => {
  const s = setup(false);
  s.effect.runPostProcessing();
  assert.equal(s.effect._blurCanvas.width, 26);
  assert.equal(s.effect._blurCanvas.height, 14);
  assert.equal(s.draws.at(-1)[0], s.effect._blurCanvas);
  assert.equal('filter' in s.effect._outputCanvasCtx, false);
});

test('background blur downsamples before blurring even when Canvas2D.filter is supported', () => {
  // Drawing (and filter-blurring) the full camera frame into the full output size, on top of the
  // same full-size draw already done for the sharp foreground, doubled the per-frame compositing
  // cost. Blur hides detail anyway, so the background layer is downsampled first on every browser
  // now (previously only the no-filter Safari fallback below did this) -- the little upscale draw
  // that follows is what actually lands on the output canvas.
  const s = setup();
  s.effect.runPostProcessing();
  assert.equal(s.effect._blurCanvas.width, 26);
  assert.equal(s.effect._blurCanvas.height, 14);
  assert.equal(s.draws.at(-1)[0], s.effect._blurCanvas);
});

test('a transient frame error does not stop the video-frame schedule', () => {
  const s = setup();
  assert.ok(s.effect._rvfcHandle !== null, 'loop should already be scheduled from startEffect');
  s.effect._renderMask = () => { throw new Error('temporarily unavailable'); };
  const handleBefore = s.effect._rvfcHandle;
  s.triggerVideoFrame();
  assert.ok(s.effect._rvfcHandle !== null, 'a thrown render error must not stop the loop from rescheduling');
  assert.notEqual(s.effect._rvfcHandle, handleBefore, 'a new requestVideoFrameCallback must have been registered');
});

test('setMaxOutputHeight always clamps to [480, 1080]', () => {
  const s = setup();

  s.effect.setMaxOutputHeight(90);
  assert.equal(s.effect._maxOutputHeight, 480);
  s.effect.setMaxOutputHeight(4000);
  assert.equal(s.effect._maxOutputHeight, 1080);
  s.effect.setMaxOutputHeight(720);
  assert.equal(s.effect._maxOutputHeight, 720);
  s.effect.setMaxOutputHeight(0);
  assert.equal(s.effect._maxOutputHeight, 720); // 0 is falsy -> DEFAULT_MAX_OUTPUT_HEIGHT (720)
});

test('_getOutputSize combines the network/call-size target and the performance cap, whichever is smaller', () => {
  const s = setup(true, { width: 1920, height: 1080 });

  s.effect.setMaxOutputHeight(1080);
  s.effect._perfCap = 1080;
  let size = s.effect._getOutputSize(1920, 1080);
  assert.equal(size.width, 1920);
  assert.equal(size.height, 1080);

  s.effect._perfCap = 480; // machine is struggling -- perf cap wins even though network allows 1080
  size = s.effect._getOutputSize(1920, 1080);
  assert.equal(size.width, 853);
  assert.equal(size.height, 480);

  s.effect._perfCap = 1080;
  s.effect.setMaxOutputHeight(480); // network/call-size wins even though the machine could do more
  size = s.effect._getOutputSize(1920, 1080);
  assert.equal(size.width, 853);
  assert.equal(size.height, 480);
});

test('Phase 3 governor: steps DOWN under sustained overload, respects a cooldown, and picks the fps lever first for v1 (cold-start rule)', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080); // network/call-size target allows the full ceiling throughout
  // This test is specifically about step-DOWN mechanics, so it starts the governor pinned at the
  // top tier regardless of the effect's actual (now bottom-tier) starting default -- see "Phase 3
  // governor: state resets when the effect (re)starts" for that default itself.
  s.effect._perfCap = 1080;
  s.effect._perfFpsCap = 30;

  // 60ms is used throughout (not 40) so duty stays over PERF_DUTY_DOWN (0.75) even once fps has
  // reached its floor (15fps): 60*15/1000 = 0.9, still over -- otherwise the fps lever alone
  // would already be enough and the resolution lever would never need to move in this test.

  // A single slow frame must not step anything -- only SUSTAINED overload does.
  s.effect._updatePerfGovernor(60); // duty = 60*30/1000 = 1.8, well over PERF_DUTY_DOWN (0.75)
  assert.equal(s.effect._perfCap, 1080);
  assert.equal(s.effect._perfFpsCap, 30);

  // Simulate the overload having already been sustained for over PERF_DUTY_DOWN_SUSTAIN_MS.
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(60);
  // v1's per-frame cost barely depends on resolution (see the Phase 3 report's duty table), so
  // the fps lever gives at least as much predicted relief -- cold-start rule steps fps first.
  assert.equal(s.effect._perfFpsCap, 20);
  assert.equal(s.effect._perfCap, 1080);

  // Still overloaded, but the cooldown after that step hasn't elapsed -- must not step again yet.
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(60);
  assert.equal(s.effect._perfFpsCap, 20);

  // Cooldown elapsed and still overloaded -- steps again.
  s.effect._lastPerfChangeAt = Date.now() - 6000;
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(60);
  assert.equal(s.effect._perfFpsCap, 15); // fps floor

  // fps is now at its floor -- the next step-down must move the OTHER lever (resolution).
  s.effect._lastPerfChangeAt = Date.now() - 6000;
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(60);
  assert.equal(s.effect._perfCap, 720);
  assert.equal(s.effect._perfFpsCap, 15);

  s.effect._lastPerfChangeAt = Date.now() - 6000;
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(60);
  assert.equal(s.effect._perfCap, 480); // resolution floor too -- both levers now at their floor

  // Both levers at their floor and still overloaded: PERF_FLOOR_EXHAUSTED_THRESHOLD (3) more
  // ticks before the floor-exhausted fallback fires; stays at floor (never disables the effect).
  for (let i = 0; i < 3; i++) {
    s.effect._lastPerfChangeAt = Date.now() - 6000;
    s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
    s.effect._updatePerfGovernor(60);
  }
  assert.equal(s.effect._perfCap, 480);
  assert.equal(s.effect._perfFpsCap, 15);
  // Already on v1 (the cheapest CPU-safe engine) -- floor-exhausted logs once and stays, it does
  // not disable/crash the effect.
  assert.ok(s.warnings.length >= 1);
  const warningsAfterFirstExhaustion = s.warnings.length;

  for (let i = 0; i < 3; i++) {
    s.effect._lastPerfChangeAt = Date.now() - 6000;
    s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
    s.effect._updatePerfGovernor(60);
  }
  assert.equal(s.warnings.length, warningsAfterFirstExhaustion, 'floor-exhausted fallback must only fire once, not every tick');
});

test('Phase 3 governor: steps back UP once comfortably fast, and never past what the network/call-size target allows', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080);
  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;

  // Very fast frames -- duty at 480p/15fps is comfortably under PERF_DUTY_UP (0.60).
  for (let i = 0; i < 10; i++) s.effect._updatePerfGovernor(5);
  assert.ok(s.effect._frameMsEma < 10);

  s.effect._perfDutyUnderBudgetSince = Date.now() - 8100;
  s.effect._lastPerfChangeAt = Date.now() - 6000;
  s.effect._updatePerfGovernor(5);
  // One of the two levers must have moved up (which one depends on predicted duty -- both are
  // exact/near-exact here since nothing has been learned yet at 5ms).
  assert.ok(s.effect._perfCap > 480 || s.effect._perfFpsCap > 15);

  // Now pin the network/call-size target to 480 and confirm resolution never climbs past it, even
  // though the fps lever has no such ceiling and can still climb.
  const s2 = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s2.effect.setMaxOutputHeight(480); // network only justifies 480 right now
  s2.effect._perfCap = 480;
  s2.effect._perfFpsCap = 15;
  for (let i = 0; i < 10; i++) s2.effect._updatePerfGovernor(2);
  s2.effect._perfDutyUnderBudgetSince = Date.now() - 8100;
  s2.effect._lastPerfChangeAt = Date.now() - 6000;
  s2.effect._updatePerfGovernor(2);
  assert.equal(s2.effect._perfCap, 480, 'resolution must never climb past the network/call-size target');
});

test('Phase 3 governor: state resets when the effect (re)starts', () => {
  const s = setup(true, { width: 1920, height: 1080 });

  s.effect.setMaxOutputHeight(1080);
  // Force the governor away from its (now bottom-tier) starting point so the reset below is
  // actually exercised, not trivially true because nothing moved.
  s.effect._perfCap = 1080;
  s.effect._perfFpsCap = 30;
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(40);
  assert.notEqual(s.effect._perfFpsCap, 30);

  s.effect.startEffect({ getVideoTracks: () => [s.track] });
  // Real reported defect (2026-10-01): resets to the BOTTOM tier, not the top -- starting a fresh
  // effect at 1080p/30fps meant every call's first few seconds ran at the heaviest possible
  // compositing cost before the governor could react, visible as a hang right when a background
  // was applied. See the field declaration's comment in JitsiStreamBackgroundEffect.ts.
  assert.equal(s.effect._perfCap, 480);
  assert.equal(s.effect._perfFpsCap, 15);
  assert.equal(s.effect._frameMsEma, 0);
  assert.equal(s.effect._perfDutyOverBudgetSince, null);
  assert.equal(s.effect._perfDutyUnderBudgetSince, null);
  assert.equal(s.effect._lastPerfChangeAt, 0);
  assert.equal(s.effect._perfChangeTimestamps.length, 0);
  assert.equal(s.effect._perfFloorWarned, false);
  assert.equal(s.effect._perfFloorExhaustedCount, 0);
  assert.equal(s.effect._perfFloorExhaustedFallbackDone, false);
  assert.equal(s.effect._perfLearnedCostMs.size, 0);
});

test('Phase 3 governor: getCurrentFrameRate is min(native frameRate, fps lever)', () => {
  const s = setup(true, { engine: 'v1' });

  assert.equal(s.effect.getCurrentFrameRate(), 15); // native 30fps, but fps lever starts at the bottom tier (15)
  s.effect._perfFpsCap = 15;
  assert.equal(s.effect.getCurrentFrameRate(), 15);
  s.effect._perfFpsCap = 30;
  s.effect._frameRate = 24; // a camera reporting a lower native rate caps it even at the top tier
  assert.equal(s.effect.getCurrentFrameRate(), 24);
});

test('Phase 3 governor: PERF_MAX_CHANGES_PER_MINUTE caps changes even once the cooldown alone would allow another', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080);
  let changes = 0;
  const before = { fpsCap: s.effect._perfFpsCap, resCap: s.effect._perfCap };

  for (let i = 0; i < 10; i++) {
    s.effect._lastPerfChangeAt = Date.now() - 6000; // cooldown always satisfied
    s.effect._perfDutyOverBudgetSince = Date.now() - 1100; // sustain always satisfied
    s.effect._updatePerfGovernor(40);
    if (s.effect._perfFpsCap !== before.fpsCap || s.effect._perfCap !== before.resCap) {
      changes++;
      before.fpsCap = s.effect._perfFpsCap;
      before.resCap = s.effect._perfCap;
    }
  }
  assert.ok(changes <= 6, `expected at most PERF_MAX_CHANGES_PER_MINUTE (6) changes, got ${changes}`);
});

// ---- Phase 3 governor acceptance tests (C1-C6) -----------------------------------------------

test('C1 fake clock: sustain windows are measured against a controllable clock, not real wall-clock waiting', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });
  let fakeNow = 1000000;
  const realDateNow = Date.now;

  Date.now = () => fakeNow;
  try {
    s.effect.setMaxOutputHeight(1080);
    // Pinned at the top tier -- this test is about sustain-window timing, not the (now bottom-tier)
    // starting default, and needs headroom to step fps down from 30 to observe the mechanics.
    s.effect._perfCap = 1080;
    s.effect._perfFpsCap = 30;
    s.effect._updatePerfGovernor(60); // over budget, sets _perfDutyOverBudgetSince = fakeNow
    assert.equal(s.effect._perfFpsCap, 30, 'must not step before the sustain window elapses');

    fakeNow += 999; // one ms short of PERF_DUTY_DOWN_SUSTAIN_MS (1000)
    s.effect._updatePerfGovernor(60);
    assert.equal(s.effect._perfFpsCap, 30, 'must not step at 999ms of sustained overload');

    fakeNow += 2; // now past 1000ms
    s.effect._updatePerfGovernor(60);
    assert.equal(s.effect._perfFpsCap, 20, 'must step exactly once the sustain window has elapsed');
  } finally {
    Date.now = realDateNow;
  }
});

test('C2 per-engine cost model from measured data: results-baseline/ medians drive each engine to a stable duty < PERF_DUTY_DOWN without disabling the effect', () => {
  // Real medians (ms) from bench/results-baseline/, computed as median-of-3 bench.total.average
  // per engine/resolution -- see the Phase 3 report for the full table and how these were read.
  const baselineCostMs = {
    v1: { 480: 25.7, 720: 27.6, 1080: 40.4 },
    'mediapipe-cpu': { 480: 23.6, 720: 36.2, 1080: 52.1 },
    'mediapipe-gpu': { 480: 13.3, 720: 18.7, 1080: 29.8 }
  };

  for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
    const s = setup(true, { width: 1920, height: 1080, engine });

    s.effect.setMaxOutputHeight(1080);
    let fakeNow = 2000000;
    const realDateNow = Date.now;

    Date.now = () => fakeNow;
    try {
      // Drive the governor for up to 60 simulated seconds using the REAL cost at whatever
      // resolution tier is currently active -- lets the governor's own lever choices play out
      // against real measured numbers, not a synthetic constant.
      for (let tick = 0; tick < 600; tick++) {
        const costAtCurrentTier = baselineCostMs[engine][s.effect._perfCap];

        s.effect._updatePerfGovernor(costAtCurrentTier);
        fakeNow += 100;
      }
      const finalDuty = (s.effect._frameMsEma * s.effect.getCurrentFrameRate()) / 1000;

      assert.ok(finalDuty < 0.75, `${engine} settled at duty ${finalDuty.toFixed(2)}, expected < PERF_DUTY_DOWN (0.75)`);
      // Never disabled/left with an impossible configuration.
      assert.ok(s.effect._perfCap >= 480 && s.effect._perfCap <= 1080);
      assert.ok(s.effect._perfFpsCap >= 15 && s.effect._perfFpsCap <= 30);
    } finally {
      Date.now = realDateNow;
    }
  }
});

test('C3 randomized anti-trap: 1000 runs with a cost that eventually drops to near-zero always recover to the top tier on both levers', () => {
  let trapped = 0;

  for (let run = 0; run < 1000; run++) {
    const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

    s.effect.setMaxOutputHeight(1080);
    let fakeNow = 3000000 + (run * 100000);
    const realDateNow = Date.now;

    Date.now = () => fakeNow;
    try {
      // Phase 1: a random, sustained-overload cost for a random number of ticks -- forces the
      // governor down some random number of steps (possibly to the floor on both levers).
      const overloadCostMs = 50 + (Math.random() * 80); // 50-130ms, always over budget at 30fps
      const overloadTicks = 5 + Math.floor(Math.random() * 40);

      for (let i = 0; i < overloadTicks; i++) {
        s.effect._updatePerfGovernor(overloadCostMs);
        fakeNow += 1200; // past the down-sustain window every tick
      }

      // Phase 2: load vanishes (near-zero cost) for long enough that -- with backoff taken into
      // account -- the governor MUST eventually reach the top of both levers. Backoff can double
      // up to PERF_PROBE_BACKOFF_CAP_MS (64s); budget generously past the worst case (2 lever
      // changes needed x up to 64s backoff each, plus sustain/cooldown) with a wide margin.
      for (let i = 0; i < 4000; i++) {
        s.effect._updatePerfGovernor(0.1);
        fakeNow += 250;
      }

      if (s.effect._perfCap !== 1080 || s.effect._perfFpsCap !== 30) {
        trapped++;
      }
    } finally {
      Date.now = realDateNow;
    }
  }
  assert.equal(trapped, 0, `${trapped}/1000 runs ended trapped below the top tier despite near-zero load`);
});

test('C4 flapping: a duty value oscillating right at the threshold cannot exceed PERF_MAX_CHANGES_PER_MINUTE', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080);
  let fakeNow = 4000000;
  const realDateNow = Date.now;
  let changes = 0;
  let lastFps = s.effect._perfFpsCap;
  let lastRes = s.effect._perfCap;

  Date.now = () => fakeNow;
  try {
    // Alternate a slightly-over-budget cost and a slightly-under-budget cost every tick, always
    // satisfying the sustain window (the cooldown/max-changes-per-minute logic is what's under
    // test, not the sustain window itself).
    for (let i = 0; i < 200; i++) {
      const overBudget = i % 2 === 0;

      s.effect._updatePerfGovernor(overBudget ? 60 : 1);
      if (overBudget) s.effect._perfDutyOverBudgetSince = fakeNow - 1100;
      else s.effect._perfDutyUnderBudgetSince = fakeNow - 8100;
      fakeNow += 200; // well under the 5s cooldown between individual ticks
      if (s.effect._perfFpsCap !== lastFps || s.effect._perfCap !== lastRes) {
        changes++;
        lastFps = s.effect._perfFpsCap;
        lastRes = s.effect._perfCap;
      }
    }
    // 200 ticks x 200ms = 40s of simulated time -- under PERF_MAX_CHANGES_PER_MINUTE's 60s
    // window, so the cap alone (not just elapsed time) must be what's bounding this.
    assert.ok(changes <= 6, `expected at most 6 changes in a 40s window, got ${changes}`);
  } finally {
    Date.now = realDateNow;
  }
});

test('GO 2 fix: a noisy EMA sitting right at the step-up eligibility boundary must not reset the sustain timer and block recovery forever', () => {
  // Found live in a real browser (bench/results/go2-governor-G1/G2/G3.json): after CPU throttling
  // released, duty stayed comfortably under PERF_DUTY_DOWN the whole time, but NEITHER lever ever
  // recovered even over many seconds with an 8x accelerated timescale. Root cause: the EMA
  // hovered right at the fps lever's next-tier eligibility boundary (~0.60 duty), flickering
  // in/out of eligibility tick to tick, and the OLD code reset _perfDutyUnderBudgetSince to null
  // on every ineligible tick -- so the sustain window (accumulated "comfortable" time) never
  // actually completed. This reproduces that exact flicker with a fake clock.
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080);
  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;
  let fakeNow = 9000000;
  const realDateNow = Date.now;

  Date.now = () => fakeNow;
  try {
    // duty = frameMsEma * 15 / 1000. Alternating 39ms/41ms keeps duty comfortably under
    // PERF_DUTY_DOWN (0.75) throughout, but the fps-lever prediction (frameMsEma * 20 / 1000)
    // straddles PERF_DUTY_UP (0.60) exactly: 39*20/1000=0.78... actually use costs whose EMA
    // converges near 30ms, so the NEXT-tier (20fps) prediction (30*20/1000=0.6) sits right on the
    // eligibility line and flickers as the EMA drifts a little above/below it each tick.
    for (let i = 0; i < 60; i++) {
      s.effect._updatePerfGovernor(i % 2 === 0 ? 29 : 31);
      fakeNow += 100; // far below the sustain window on its own -- accumulation across ticks is what's under test
    }
    // Comfortable duty has now been accumulating for ~6s of simulated time; with the timer no
    // longer reset by per-tick eligibility flicker, the sustain window (1s in this test, since
    // PERF_DUTY_UP_SUSTAIN_MS=8000 needs governor to have been continuously under budget -- here
    // asserted via the timer itself, not via a step, since exact eligibility timing depends on
    // the EMA's exact trajectory) must have been running continuously, not repeatedly reset to null.
    assert.notEqual(s.effect._perfDutyUnderBudgetSince, null, 'the sustain timer must not have been reset to null by eligibility flicker while duty stayed comfortable');
  } finally {
    Date.now = realDateNow;
  }
});

test('C5 ceiling/floor: getCurrentOutputHeight never exceeds the network/call-size target, fps never drops below 15 or exceeds 30', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'mediapipe-cpu' });

  s.effect.setMaxOutputHeight(720); // network only justifies 720 -- getCurrentOutputHeight must never exceed it
  let fakeNow = 5000000;
  const realDateNow = Date.now;

  Date.now = () => fakeNow;
  try {
    for (let i = 0; i < 500; i++) {
      const cost = Math.random() < 0.5 ? (5 + Math.random() * 5) : (40 + Math.random() * 40);

      s.effect._updatePerfGovernor(cost);
      s.effect._perfDutyOverBudgetSince = fakeNow - 1100;
      s.effect._perfDutyUnderBudgetSince = fakeNow - 8100;
      fakeNow += 1200;
      // _perfCap itself (what the MACHINE can do) is independent of the network target and may
      // legitimately sit above it (e.g. still at its initial top tier, having never needed to
      // step down) -- getCurrentOutputHeight is where the two combine (Math.min), and that is the
      // real, user-facing guarantee.
      assert.ok(s.effect.getCurrentOutputHeight() <= 720, `getCurrentOutputHeight ${s.effect.getCurrentOutputHeight()} exceeded the network target (720)`);
      assert.ok(s.effect._perfCap >= 480, `resolution ${s.effect._perfCap} went below the floor (480)`);
      assert.ok(s.effect._perfFpsCap >= 15, `fps ${s.effect._perfFpsCap} went below the floor (15)`);
      assert.ok(s.effect._perfFpsCap <= 30, `fps ${s.effect._perfFpsCap} exceeded the ceiling (30)`);
    }
  } finally {
    Date.now = realDateNow;
  }
});

test('C6 sender consistency: getCurrentOutputHeight/getCurrentFrameRate always reflect the SAME _perfCap/_perfFpsCap the governor just set, never a stale value', () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1' });

  s.effect.setMaxOutputHeight(1080);
  let fakeNow = 6000000;
  const realDateNow = Date.now;

  Date.now = () => fakeNow;
  try {
    for (let i = 0; i < 50; i++) {
      s.effect._updatePerfGovernor(60);
      s.effect._perfDutyOverBudgetSince = fakeNow - 1100;
      fakeNow += 6000; // past cooldown every tick -- maximises how often a change can happen
      // getCurrentOutputHeight is capped by native height (1080) too -- with setMaxOutputHeight
      // and native height both at/above _perfCap, the binding constraint is always _perfCap.
      assert.equal(s.effect.getCurrentOutputHeight(), s.effect._perfCap);
      assert.equal(s.effect.getCurrentFrameRate(), Math.min(s.effect._frameRate, s.effect._perfFpsCap));
    }
  } finally {
    Date.now = realDateNow;
  }
});

test('floor-exhausted fallback: does NOT fall back to v1 when v1 is not measurably cheaper (GO 2 fix)', () => {
  // mediapipe-cpu's real measured cost (post Phase 2c fixes, ~15.3ms @720p) is CHEAPER than v1's
  // (~27.5ms) -- falling back to v1 here would make things worse, not better, which is exactly
  // the bug GO 2 reported and this fixes. _handlePerfFloorExhausted is exercised directly (with
  // realistic floor-tier state and a realistic learned cost) rather than via a full duty-crossing
  // descent, since a cost low enough to be "genuinely cheap" cannot also be high enough to
  // organically trigger floor-exhaustion (duty > 0.75 even at the 15fps floor implies cost
  // > 50ms) -- this isolates the one decision under test.
  const s = setup(true, { width: 1920, height: 1080, engine: 'mediapipe-cpu' });

  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;
  s.effect._perfLearnedCostMs.set('mediapipe-cpu:480', { at: Date.now(), costMs: 15.3 });
  s.effect._handlePerfFloorExhausted();
  assert.equal(s.effect._engine, 'mediapipe-cpu', 'must NOT have fallen back to a more expensive engine');
  assert.ok(s.warnings.some((w) => String(w.join(' ')).includes('not measurably cheaper')));
});

test('floor-exhausted fallback: DOES fall back to v1 when v1 is genuinely measurably cheaper', async () => {
  const s = setup(true, { width: 1920, height: 1080, engine: 'mediapipe-cpu', v1Fallback: { tflite: {} } });

  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;
  // A genuinely expensive learned cost for THIS session (60ms > v1's ~27.5ms reference) -- e.g. a
  // pathological device/camera combination where mediapipe-cpu really is the worse choice here.
  s.effect._perfLearnedCostMs.set('mediapipe-cpu:480', { at: Date.now(), costMs: 60 });
  s.effect._handlePerfFloorExhausted();
  // _fallBackToV1 loads the (mock) TFLite model asynchronously before switching _engine -- let
  // that microtask/promise chain settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(s.effect._engine, 'v1', 'must have fallen back to v1, the measurably cheaper engine here');
  assert.ok(s.warnings.some((w) => String(w.join(' ')).includes('measurably cheaper')));
});

test('GO 3 give-up tier: v1 already, floor exhausted, no cheaper engine -- calls onGiveUp, stops the timer loop, hasGivenUp() is true', () => {
  let giveUpCalls = 0;
  const s = setup(true, { width: 1920, height: 1080, engine: 'v1', onGiveUp: () => { giveUpCalls++; } });

  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;
  assert.equal(s.effect.hasGivenUp(), false);
  s.effect._handlePerfFloorExhausted();
  assert.equal(giveUpCalls, 1);
  assert.equal(s.effect.hasGivenUp(), true);
  assert.equal(s.effect._rvfcHandle, null, 'the frame loop must be stopped, not left running to burn CPU');
  assert.ok(s.warnings.some((w) => String(w.join(' ')).includes('giving up')));

  // Idempotent -- a second call (e.g. a stray governor tick before the caller reacts) must not
  // call onGiveUp again.
  s.effect._handlePerfFloorExhausted();
  assert.equal(giveUpCalls, 1);
});

test('GO 3 give-up tier: draws one real camera frame before stopping, so the track never freezes on a blank/black canvas', () => {
  // Real bug found live (2026-09-30): the output canvas starts completely blank the instant
  // startEffect() hands its captureStream() track to the caller, and stays that way until the
  // first successful _renderMask() tick. If the governor gives up before that ever happens (a
  // struggling device), the track's last-ever frame was that initial blank one -- black/frozen
  // in the receiver's Picture-in-Picture window until the caller's async track swap completes.
  const s = setup(true, { engine: 'v1' });

  s.draws.length = 0; // clear whatever startEffect/prior renders already queued
  assert.equal(s.effect.hasGivenUp(), false);
  s.effect._giveUp('test');
  assert.equal(s.effect.hasGivenUp(), true);
  assert.ok(
      s.draws.some((args) => args[0] === s.video),
      '_giveUp must draw the real (unprocessed) camera frame directly, not leave the canvas blank'
  );
});

test('GO 3 give-up tier: mediapipe-cpu, floor exhausted, v1 not measurably cheaper -- also gives up (not a silent no-op)', () => {
  let giveUpCalls = 0;
  const s = setup(true, { width: 1920, height: 1080, engine: 'mediapipe-cpu', onGiveUp: () => { giveUpCalls++; } });

  s.effect._perfCap = 480;
  s.effect._perfFpsCap = 15;
  s.effect._perfLearnedCostMs.set('mediapipe-cpu:480', { at: Date.now(), costMs: 15.3 }); // cheaper than v1's reference
  s.effect._handlePerfFloorExhausted();
  assert.equal(giveUpCalls, 1);
  assert.equal(s.effect.hasGivenUp(), true);
  assert.equal(s.effect._engine, 'mediapipe-cpu', 'must not have fallen back -- v1 was not cheaper');
});

test('GO 3 give-up tier: _renderMask is a no-op once given up (no black frame -- it just stops drawing, caller restores the raw track)', () => {
  const s = setup(true, { engine: 'v1' });
  let frames = 0;

  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect._renderMask();
  assert.equal(frames, 1);
  s.effect._hasGivenUp = true;
  s.effect._renderMask();
  assert.equal(frames, 1, 'no further work once given up');
});

test('GO 3 give-up tier: state resets on a fresh startEffect (a new device/camera may be fast enough)', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect._hasGivenUp = true;
  s.effect._gaveUpAt = Date.now();
  s.effect.startEffect({ getVideoTracks: () => [ s.track ] });
  assert.equal(s.effect.hasGivenUp(), false);
  assert.equal(s.effect._gaveUpAt, null);
});

test('getCurrentOutputHeight reflects the caps and native camera size, not the last drawn frame', () => {
  const s = setup(true, { width: 1920, height: 1080 });

  // Both caps at the top -- limited only by the native camera height.
  s.effect.setMaxOutputHeight(1080);
  s.effect._perfCap = 1080;
  assert.equal(s.effect.getCurrentOutputHeight(), 1080);

  // Network/call-size target is the binding constraint.
  s.effect.setMaxOutputHeight(480);
  s.effect._perfCap = 1080;
  assert.equal(s.effect.getCurrentOutputHeight(), 480);

  // Performance governor is the binding constraint.
  s.effect.setMaxOutputHeight(1080);
  s.effect._perfCap = 720;
  assert.equal(s.effect.getCurrentOutputHeight(), 720);

  // A smaller native camera is the binding constraint (never upscaled).
  const small = setup(true, { width: 640, height: 360 });

  small.effect.setMaxOutputHeight(1080);
  small.effect._perfCap = 1080;
  assert.equal(small.effect.getCurrentOutputHeight(), 360);

  // Correct even though runPostProcessing (which draws the actual frame) was never called --
  // i.e. it isn't derived from the last composited frame.
  assert.equal(s.draws.length, 0);
});

// --- Phase 2: MediaPipe engine -------------------------------------------------------------

test('V1 SAFETY: the TFLite inference core (runInference, the EMA blend, the input-memory loop) is byte-for-byte unchanged', () => {
  // Original Phase 2 rule was "do not refactor resizeSource/runInference at all" -- accepted
  // change (this session): resizeSource() now accepts an explicit sourceFrame (defaulting to the
  // live video element), because _renderMask() captures ONE canvas snapshot per frame and feeds
  // the SAME snapshot to both V1 and MediaPipe, fixing a real race (segmentation and compositing
  // could previously see two different decoded video frames a few ms apart -- a real source of
  // motion-trail/misalignment). What must still never change is the actual TFLite inference core
  // below the draw call: the input-memory-writing loop, runInference() itself, and the EMA blend.
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(
      source,
      /resizeSource\(sourceFrame: CanvasImageSource = this\._inputVideoElement\) \{\n\s*this\._segmentationMaskCtx\?\.drawImage\(\n\s*sourceFrame,/,
      'resizeSource() must draw the passed-in sourceFrame (defaulting to the live video element, so a caller passing nothing is unaffected)'
  );
  assert.match(
      source,
      /for \(let i = 0; i < this\._segmentationPixelCount; i\+\+\) \{\n\s*this\._model\.HEAPF32\[inputMemoryOffset \+ \(i \* 3\)\] = Number\(imageData\?\.data\[i \* 4\]\) \/ 255;/,
      'resizeSource()\'s TFLite input-memory loop must be unchanged'
  );
  assert.match(source, /runInference\(\) \{\n\s*this\._model\._runInference\(\);/, 'runInference() opening must be unchanged');
  assert.match(
      source,
      /const smoothed = \(this\._smoothedMask\[i\] \* MASK_TEMPORAL_SMOOTHING\) \+ \(person \* \(1 - MASK_TEMPORAL_SMOOTHING\)\);\n\n\s*this\._smoothedMask\[i\] = smoothed;\n\s*this\._segmentationMask\.data\[\(i \* 4\) \+ 3\] = 255 \* smoothed;/,
      'runInference()\'s EMA blend must be unchanged'
  );
  assert.match(
      source,
      /if \(this\._engine === 'v1'\) \{[\s\S]*?this\.resizeSource\(sourceFrame\);\n\s*this\.runInference\(\);/,
      '_renderMask() must still call resizeSource() then runInference(), in that order (with nothing V1-specific between them), for the v1 engine -- now passing the captured per-frame snapshot'
  );
});

test('V1 edge/opacity fix (2026-09-30): _renderMask calls _sharpenV1Mask() as a POST-processing step after runInference(), never inside it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(
      source,
      /this\.resizeSource\(sourceFrame\);\n\s*this\.runInference\(\);[\s\S]*?this\._sharpenV1Mask\(\);/,
      '_sharpenV1Mask() must be called strictly after runInference() returns, as a separate step -- runInference() itself stays untouched'
  );
});

test('V1 edge/opacity fix: _sharpenV1Mask makes a confident pixel fully opaque and a low-confidence pixel fully transparent', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect._segmentationMask.data[3] = 255 * 0.9; // confidently person
  s.effect._segmentationMask.data[7] = 255 * 0.1; // confidently background
  s.effect._segmentationMask.data[11] = 255 * 0.5; // ambiguous -- should land near the middle, not clamped
  s.effect._sharpenV1Mask();
  assert.equal(s.effect._segmentationMask.data[3], 255, 'a confident foreground pixel must be fully opaque, not merely mostly-opaque');
  assert.equal(s.effect._segmentationMask.data[7], 0, 'a confident background pixel must be fully transparent');
  assert.ok(s.effect._segmentationMask.data[11] > 0 && s.effect._segmentationMask.data[11] < 255, 'an ambiguous pixel should still get the soft feathered curve, not be hard-clamped');
});

test('setVirtualBackground: updates config in place without touching engine/governor state (fixes the "changing background is laggy" defect)', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect._perfCap = 480; // simulate a governor that already learned this device needs 480p
  s.effect._perfFpsCap = 15;
  s.effect.setVirtualBackground({ backgroundType: 'blur', blurValue: 8 });
  assert.equal(s.effect._options.virtualBackground.blurValue, 8);
  // The whole point: switching background must NOT reset governor state back to the top tier.
  assert.equal(s.effect._perfCap, 480);
  assert.equal(s.effect._perfFpsCap, 15);
});

// ---------------------------------------------------------------------------------------------
// Phase 2 (Virtual Background & PiP Performance Audit, section 9): the one real cost left behind
// by the Phase-2-predecessor (2026-09-30) in-place-reuse fix above -- switching TO a not-yet-
// decoded image background used to flip _options.virtualBackground to IMAGE immediately, and
// _renderMask()'s own readiness gate then skipped every frame until that specific image finished
// loading. setVirtualBackground() now routes every image switch through the shared
// backgroundImageCache module (mocked above) and never touches _options.virtualBackground/
// _virtualImage until the replacement is ACTUALLY ready -- so the effect keeps rendering whatever
// was active a moment ago the entire time a new image is loading.
// ---------------------------------------------------------------------------------------------

test('Phase 2: switching between two already-cached (preloaded) backgrounds applies instantly, no pending state', () => {
  const s = setup(true, { engine: 'v1' });

  s.seedImageCache('/images/one.jpg');
  s.seedImageCache('/images/two.jpg');
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'image', 'a cache hit must apply synchronously, not asynchronously');
  assert.equal(s.effect._virtualImage.src.endsWith('/images/one.jpg'), true);
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/two.jpg' });
  assert.equal(s.effect._virtualImage.src.endsWith('/images/two.jpg'), true);
  assert.equal(s.getImageDecodeStarts(), 0, 'both images were pre-seeded as already decoded -- no real decode should ever have been started');
});

test('Phase 2: switching to an image that has not been decoded yet keeps the OLD background active (blur) until it resolves', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.setVirtualBackground({ backgroundType: 'blur', blurValue: 25 });
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  // Not resolved yet -- must still be rendering the blur that was active before this call, not a
  // half-applied image config and not a frozen frame.
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'blur', 'must keep the PREVIOUS background config active while the new image decodes');
  assert.equal(s.effect._options.virtualBackground.blurValue, 25);
  assert.ok(s.hasPendingImageLoad('/images/one.jpg'));

  s.resolveImageLoad('/images/one.jpg');
  await flushMicrotasks();
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'image', 'once decoded, the config swaps to the new image');
  assert.equal(s.effect._virtualImage.src.endsWith('/images/one.jpg'), true);
});

test('Phase 2: a pending image load does not stop frames from rendering in the meantime (old background keeps compositing)', () => {
  const s = setup(true, { engine: 'v1' });
  let frames = 0;

  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  s.effect._renderMask();
  assert.equal(frames, 1, 'a frame must still be produced (using whatever was active before) while the new image is mid-decode, not skipped');
});

test('Phase 2: rapid image A -> image B selection -- the newest selection wins, the stale A completion is discarded', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/a.jpg' });
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/b.jpg' });
  s.resolveImageLoad('/images/a.jpg'); // the OLDER request finishes first (realistic: smaller/cached file)
  await flushMicrotasks();
  assert.notEqual(s.effect._virtualImageSrc, '/images/a.jpg', 'a superseded selection must never overwrite a newer one, even if it resolves first');
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'blur', 'B has not resolved yet -- the effect must still be on whatever was active before A/B were ever selected');

  s.resolveImageLoad('/images/b.jpg');
  await flushMicrotasks();
  assert.equal(s.effect._virtualImage.src.endsWith('/images/b.jpg'), true);
  assert.equal(s.effect._options.virtualBackground.virtualSource, '/images/b.jpg');
});

test('Phase 2: switching to blur WHILE an image is still loading discards that pending load cleanly', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  s.effect.setVirtualBackground({ backgroundType: 'blur', blurValue: 8 });
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'blur', 'blur must apply immediately -- it never needs to wait on anything');
  s.resolveImageLoad('/images/one.jpg'); // the now-irrelevant image finishes decoding moments later
  await flushMicrotasks();
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'blur', 'a late image completion must not pull the effect back onto an image the user already moved away from');
});

test('Phase 2: a failed image load does not break the active camera/meeting -- previous background stays active and a warning is logged', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.setVirtualBackground({ backgroundType: 'blur', blurValue: 25 });
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/broken.jpg' });
  s.rejectImageLoad('/images/broken.jpg', 'simulated 404');
  await flushMicrotasks();
  assert.equal(s.effect._options.virtualBackground.backgroundType, 'blur', 'the background active before the failed switch must remain active');
  assert.equal(s.effect._options.virtualBackground.blurValue, 25);
  assert.equal(s.warnings.length, 1);
  let frames = 0;

  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect._renderMask();
  assert.equal(frames, 1, 'the camera/effect must keep producing frames after a failed image load, not freeze or throw');
});

test('Phase 2: re-selecting the exact image that is already active and applied is a pure no-op (no re-decode)', () => {
  const s = setup(true, { engine: 'v1' });

  s.seedImageCache('/images/one.jpg');
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  const imageRefBefore = s.effect._virtualImage;

  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  assert.equal(s.effect._virtualImage, imageRefBefore, 'must not swap to a different (even if equivalent) image object for a no-op re-selection');
  assert.equal(s.getImageDecodeStarts(), 0, 'the already-active image must not be re-decoded just because it was selected again');
});

test('Phase 2: stopEffect while an image load is still pending does not throw and does not apply after cleanup', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  assert.doesNotThrow(() => s.effect.stopEffect());
  assert.doesNotThrow(() => s.resolveImageLoad('/images/one.jpg'), 'a load resolving after teardown must not throw even though the effect is already stopped');
  await flushMicrotasks();
});

test('Phase 2: no unnecessary segmentation-engine recreation across an image switch (same engine/governor instance the whole time)', () => {
  const s = setup(true, { engine: 'v1' });
  const engineBefore = s.effect._engine;
  const modelBefore = s.effect._model;

  s.seedImageCache('/images/one.jpg');
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  assert.equal(s.effect._engine, engineBefore);
  assert.equal(s.effect._model, modelBefore, 'the same V1 model instance must still be in use -- no new effect/engine was created for this switch');
});

test('Phase 2: camera track is unchanged by an image switch -- no Jitsi replaceTrack/captureStream restart', () => {
  const s = setup(true, { engine: 'v1' });
  const sourceTrackBefore = s.effect._sourceTrack;
  const outputCanvasBefore = s.effect._outputCanvasElement;

  s.seedImageCache('/images/one.jpg');
  s.effect.setVirtualBackground({ backgroundType: 'image', virtualSource: '/images/one.jpg' });
  assert.equal(s.effect._sourceTrack, sourceTrackBefore);
  assert.equal(s.effect._outputCanvasElement, outputCanvasBefore, 'the same output canvas (and therefore the same captureStream() track already handed to Jitsi/PiP) must keep being drawn into');
});

test('MediaPipe engine: a successful frame updates the mask and always closes it', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 5, maskHeight: 4, values: new Float32Array(20).fill(0.9) } });

  s.effect._renderMask();
  assert.equal(s.mediaPipeCalls.segmentForVideo, 1);
  assert.equal(s.mediaPipeCalls.close, 1);
  assert.equal(s.effect._options.width, 5);
  assert.equal(s.effect._options.height, 4);
  assert.equal(s.effect._segmentationPixelCount, 20);
  // The first frame now snaps directly to the raw value (0.9) instead of being blended against a
  // zero-filled _smoothedMask -- the old (0 * 0.6) + (0.9 * 0.4) = 0.36 behavior was a real bug
  // (a visible fade-in flash the instant the effect turns on), fixed by special-casing frame one.
  // 0.9 then passes through sharpenMaskAlpha -- since 0.9 >= MASK_HARD_OPAQUE_ABOVE (0.75), this
  // now hard-clamps straight to fully opaque (255), not the softer steepened-curve value the mask
  // used to land on -- see sharpenMaskAlpha's comment for the reported "faded body" defect this
  // fixes: a confident foreground pixel must render fully solid, not merely mostly-opaque.
  assert.equal(s.effect._segmentationMask.data[3], 255);
});

test('MediaPipe engine: mask.close() is called even when segmentForVideo throws', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnSegment: true } });

  s.effect._renderMask();
  // The mask object is never created in this failure mode (the throw happens before it's read),
  // so there is nothing to close -- confirming this doesn't throw or leave the frame loop dead is
  // the actual assertion here (see 'a transient frame error does not stop the worker schedule'-
  // style tests above for the loop-survival guarantee at the timer level).
  assert.equal(s.mediaPipeCalls.close, 0);
  assert.equal(s.warnings.length, 1);
});

test('MediaPipe engine: mask.close() is called even when getAsFloat32Array() throws', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnReadback: true } });

  s.effect._renderMask();
  assert.equal(s.mediaPipeCalls.close, 1, 'the mask WAS created and must still be closed even though reading it failed');
});

test('MediaPipe engine: mask.close() is called even when no confidence mask is returned', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { noMask: true } });

  s.effect._renderMask();
  assert.equal(s.mediaPipeCalls.close, 0);
  assert.equal(s.warnings.length, 1);
});

test('MediaPipe engine: mask resize resets _smoothedMask and resizes the mask canvas/ImageData', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 4, maskHeight: 3 } });

  s.effect._renderMask();
  assert.equal(s.effect._segmentationMaskCanvas.width, 4);
  assert.equal(s.effect._segmentationMaskCanvas.height, 3);
  const smoothedAfterFirst = s.effect._smoothedMask;

  s.effect._renderMask();
  // Same size the second time -- _smoothedMask must be the SAME array (carrying the EMA across
  // frames), not reset.
  assert.equal(s.effect._smoothedMask, smoothedAfterFirst);

  // Now the mask reports a different size (e.g. simulating a device switch).
  s.effect._mediaPipeSegmenter.segmentForVideo = () => ({
    confidenceMasks: [ {
      width: 8, height: 6, getAsFloat32Array: () => new Float32Array(48).fill(0.5), close: () => { s.mediaPipeCalls.close++; }
    } ]
  });
  s.effect._renderMask();
  assert.equal(s.effect._segmentationMaskCanvas.width, 8);
  assert.equal(s.effect._segmentationMaskCanvas.height, 6);
  assert.equal(s.effect._segmentationPixelCount, 48);
  assert.notEqual(s.effect._smoothedMask, smoothedAfterFirst, '_smoothedMask must be reset (a new array) on a size change');
  assert.equal(s.effect._smoothedMask.length, 48);
});

test('MediaPipe engine: falls back to V1 after repeated consecutive failures, and stays on V1', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnSegment: true }, v1Fallback: { tflite: { marker: 'fallback-tflite' } } });

  assert.equal(s.effect._engine, 'mediapipe-cpu');
  for (let i = 0; i < 5; i++) s.effect._renderMask();
  assert.equal(s.mediaPipeCalls.segmentForVideo, 5, 'exactly the threshold\'s worth of attempts before falling back');

  // The fallback's TFLite load is async (a dynamic import in real code); a couple of layers of
  // mock/Promise wrapping between it and the assertion below add a couple of extra microtask
  // hops -- a macrotask flush (setTimeout 0) is a simpler, more robust way to wait for "every
  // pending microtask has settled" than guessing the exact tick count.
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    assert.equal(s.loadV1FallbackCalls.length, 1);
    assert.equal(s.effect._engine, 'v1');
    assert.equal(s.effect._model.marker, 'fallback-tflite');
    assert.equal(s.effect._options.width, 256);
    assert.equal(s.effect._options.height, 144);

    // Further frames must not re-attempt MediaPipe or re-trigger the fallback load.
    s.effect.resizeSource = () => {};
    s.effect.runInference = () => {};
    s.effect._renderMask();
    assert.equal(s.mediaPipeCalls.segmentForVideo, 5, 'must not call MediaPipe again after falling back to v1');
    assert.equal(s.loadV1FallbackCalls.length, 1, 'must not reload the V1 fallback again');
  });
});

test('MediaPipe engine: does NOT fall back to V1 before the consecutive-error threshold is reached', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnSegment: true } });

  for (let i = 0; i < 4; i++) s.effect._renderMask();
  assert.equal(s.effect._engine, 'mediapipe-cpu');
  assert.equal(s.loadV1FallbackCalls.length, 0);
});

test('MediaPipe engine: a successful frame resets the consecutive-error counter', () => {
  let shouldThrow = true;
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: {} });

  s.effect._mediaPipeSegmenter.segmentForVideo = (videoEl, timestamp) => {
    s.mediaPipeCalls.segmentForVideo++;
    if (shouldThrow) throw new Error('simulated');

    return { confidenceMasks: [ { width: 4, height: 3, getAsFloat32Array: () => new Float32Array(12).fill(0.5), close: () => { s.mediaPipeCalls.close++; } } ] };
  };

  for (let i = 0; i < 4; i++) s.effect._renderMask();
  shouldThrow = false;
  s.effect._renderMask(); // success -- resets the counter
  shouldThrow = true;
  for (let i = 0; i < 4; i++) s.effect._renderMask(); // 4 more failures -- still under threshold since it reset
  assert.equal(s.effect._engine, 'mediapipe-cpu', 'the counter reset on the successful frame, so 4+4 failures must not trip the 5-in-a-row threshold');
});

test('a failed MediaPipe frame skips compositing entirely instead of drawing a fresh camera frame against a stale mask', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnSegment: true } });
  let postProcessCalls = 0;

  s.effect.runPostProcessing = () => { postProcessCalls++; };
  s.effect._renderMask();
  assert.equal(postProcessCalls, 0, 'compositing must be skipped on a failed frame, not run against a stale mask + fresh video');
});

test('a successful MediaPipe frame still composites normally (the skip above is failure-only)', () => {
  const s = setup(true, { engine: 'mediapipe-cpu' });
  let postProcessCalls = 0;

  s.effect.runPostProcessing = () => { postProcessCalls++; };
  s.effect._renderMask();
  assert.equal(postProcessCalls, 1);
});

test('GO 3 give-up tier: MediaPipe fails repeatedly AND the V1 fallback also fails to load -- gives up instead of retrying forever with no recovery path', () => {
  let giveUpCalls = 0;
  const s = setup(true, {
    engine: 'mediapipe-cpu',
    mediaPipe: { throwOnSegment: true },
    v1Fallback: { reject: true },
    onGiveUp: () => { giveUpCalls++; }
  });

  for (let i = 0; i < 5; i++) s.effect._renderMask();
  assert.equal(s.loadV1FallbackCalls.length, 1);

  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    assert.equal(giveUpCalls, 1, 'must give up (restoring the raw camera via onGiveUp) rather than staying stuck on the broken engine');
    assert.equal(s.effect.hasGivenUp(), true);
    assert.ok(s.warnings.some((w) => String(w.join(' ')).includes('also failed to load')));
  });
});

test('MediaPipe engine: motion-adaptive smoothing reacts fast to a real jump in confidence', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 1, maskHeight: 1, values: new Float32Array([ 0.2 ]) } });

  s.effect._renderMask(); // first frame -- snaps directly to 0.2 (see the first-frame fix above)
  // Float32Array round-trips 0.2 as ~0.20000000298023224, not the float64 literal 0.2 -- an
  // approximate comparison, not assert.equal, is the correct check here.
  assert.ok(Math.abs(s.effect._smoothedMask[0] - 0.2) < 1e-6);

  // A large jump (0.2 -> 0.9, delta 0.7, well past MOTION_DELTA_FULL) lands at the motion floor
  // (0.05): 0.2*0.05 + 0.9*0.95 = 0.865 -- the OLD flat MEDIAPIPE_MASK_TEMPORAL_SMOOTHING (0.25)
  // would have given 0.2*0.25 + 0.9*0.75 = 0.725 regardless of how big the real change was.
  s.effect._mediaPipeSegmenter.segmentForVideo = () => {
    s.mediaPipeCalls.segmentForVideo++;

    return { confidenceMasks: [ { width: 1, height: 1, getAsFloat32Array: () => new Float32Array([ 0.9 ]), close: () => { s.mediaPipeCalls.close++; } } ] };
  };
  s.effect._renderMask();
  assert.ok(s.effect._smoothedMask[0] > 0.8, `expected fast tracking of a real jump (>0.8), got ${s.effect._smoothedMask[0]}`);
});

test('MediaPipe engine: motion-adaptive smoothing stays heavily smoothed for a near-stationary pixel', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 1, maskHeight: 1, values: new Float32Array([ 0.5 ]) } });

  s.effect._renderMask(); // first frame -- snaps to 0.5
  // A small delta (0.02, well under MOTION_DELTA_FULL) should land close to the MAX-smoothing
  // prediction (0.5*0.25 + 0.52*0.75 = 0.515) and clearly short of the MIN-smoothing/full-motion
  // prediction (0.5*0.05 + 0.52*0.95 = 0.519) -- i.e. still mostly treated as stationary, not
  // full motion, even though it moves some (motion-adaptive, not a hard on/off switch).
  s.effect._mediaPipeSegmenter.segmentForVideo = () => {
    s.mediaPipeCalls.segmentForVideo++;

    return { confidenceMasks: [ { width: 1, height: 1, getAsFloat32Array: () => new Float32Array([ 0.52 ]), close: () => { s.mediaPipeCalls.close++; } } ] };
  };
  s.effect._renderMask();
  assert.ok(
      s.effect._smoothedMask[0] < 0.517,
      `expected near-max smoothing for a near-stationary pixel (< 0.517), got ${s.effect._smoothedMask[0]}`
  );
});

// --- Phase 2b: measurement tools -----------------------------------------------------------

test('Phase 2b SAFETY: the normal draw path is byte-for-byte identical with both debug flags off', () => {
  const off = setup(true, { engine: 'mediapipe-cpu' });

  off.effect._renderMask();
  const drawsWithFlagsOff = off.draws.map((args) => args.map(String));

  const on = setup(true, { engine: 'mediapipe-cpu' });

  on.effect._renderMask();
  const drawsWithFlagsOn = on.draws.map((args) => args.map(String));

  // Same effect, same inputs, both flags at their real default (off) -- must produce the exact
  // same sequence of canvas draws. This is the actual normal path every real call runs.
  assert.deepEqual(drawsWithFlagsOn, drawsWithFlagsOff);
});

test('Phase 2b: enabling toowix_bg_debug_mask adds exactly one extra draw on top of the unchanged normal path, and restores the real mask afterward', () => {
  const baseline = setup(true, { engine: 'mediapipe-cpu' });

  baseline.effect._renderMask();
  const baselineDrawCount = baseline.draws.length;

  const s = setup(true, { engine: 'mediapipe-cpu' });

  s.setMaskDebug(true);
  s.effect._renderMask();

  assert.equal(s.draws.length, baselineDrawCount + 1, 'exactly one additional draw (the grayscale mask visualization) on top of the normal path');
  // Must not throw or corrupt state on a second frame -- proves the restore step (putImageData
  // of the real, untouched this._segmentationMask back onto the mask canvas) leaves the effect
  // in a state where normal rendering can continue.
  s.effect._renderMask();
  assert.equal(s.draws.length, baselineDrawCount + 1 + baselineDrawCount + 1);
});

test('Phase 2b: enabling toowix_bg_debug_overlay draws a text overlay once metrics exist, without touching the normal path', () => {
  const s = setup(true, { engine: 'mediapipe-cpu' });

  s.setOverlayDebug(true);
  // _lastDebugLogAt starts at 0, so the once-a-second bucket always flushes on the very first
  // frame (any real elapsed time since epoch is already >= 1000ms) -- metrics exist immediately.
  s.effect._renderMask();
  assert.ok(s.effect._lastOverlayMetrics, 'metrics must be populated once the bucket flushes, independent of DEBUG_PERF_LOG');
  assert.equal(s.effect._lastOverlayMetrics.engine, 'mediapipe-cpu');

  const baseline = setup(true, { engine: 'mediapipe-cpu' });

  baseline.effect._renderMask();
  // The overlay is text (fillRect/fillText), not a drawImage -- the normal compositing draws
  // (drawImage calls) must be identical to the flags-off baseline; the overlay shows up
  // separately, in textOverlayCalls.
  assert.equal(s.draws.length, baseline.draws.length, 'the normal drawImage-based compositing must be unaffected by the text overlay');
  assert.ok(s.textOverlayCalls.some(([ method ]) => method === 'fillText'), 'the text overlay must actually draw text');
  assert.ok(s.textOverlayCalls.some(([ method ]) => method === 'fillRect'), 'the text overlay must draw its background box');

  // A second frame within the same second draws the overlay again (using the same cached
  // metrics -- the once-a-second bucket doesn't need to re-flush for the overlay to keep
  // showing).
  const overlayCallsAfterFirst = s.textOverlayCalls.length;

  s.effect._renderMask();
  assert.ok(s.textOverlayCalls.length > overlayCallsAfterFirst, 'the overlay must redraw on every frame, not just once');
});

test('Phase 2b: dropped-frame counting only counts frames slower than 1000/30ms', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  // _lastDebugLogAt starts at 0, so the very first _updateDebugMetrics call always flushes (and
  // resets) the bucket immediately -- push it past "now" first so the two calls below land in
  // the SAME bucket instead of the first one being flushed away before the second arrives.
  s.effect._lastDebugLogAt = Date.now();
  s.effect._updateDebugMetrics(10, 5, 0, 0, 5); // fast frame -- not dropped
  s.effect._updateDebugMetrics(50, 40, 0, 0, 10); // slow frame -- dropped
  assert.equal(s.effect._debugAccum.droppedFrames, 1);
  assert.equal(s.effect._debugAccum.count, 2);
});

test('window.__bgBench: rejects when no effect is active', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.stopEffect();
  await assert.rejects(() => s.window.__bgBench ? s.window.__bgBench(1) : Promise.reject(new Error('not registered')));
});

test('Phase 4: window.__bgFrameStatus reports frame-age/camera-input/stall-recovery diagnostics for the active effect, and an error object when none is active', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect._renderMask();
  const status = s.window.__bgFrameStatus();

  assert.equal(typeof status.frameAgeMs, 'number');
  assert.equal(typeof status.cameraInputFrameCount, 'number');
  assert.equal(typeof status.totalFrameCount, 'number');
  assert.equal(status.stallWatchdogRecoveries, 0);

  s.effect.stopEffect();
  assert.ok(s.window.__bgFrameStatus().error, 'must report an error object (not throw) once no effect is active, same shape as __bgBench\'s own rejection');
});

test('runBenchmark: collects per-frame samples for the requested duration and returns min/average/p95/max plus fps', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};

  const benchPromise = s.effect.runBenchmark(0.05); // 50ms window

  // Simulate several frames landing during the benchmark window.
  s.effect._updateDebugMetrics(10, 4, 0, 0, 6);
  s.effect._updateDebugMetrics(12, 5, 0, 0, 7);
  s.effect._updateDebugMetrics(40, 30, 0, 0, 10); // a dropped one in the mix

  const result = await benchPromise;

  assert.equal(result.engine, 'v1');
  assert.equal(result.frames, 3);
  assert.equal(result.droppedFrames, 1);
  assert.equal(result.total.min, 10);
  assert.equal(result.total.max, 40);
  assert.ok(result.total.average > 10 && result.total.average < 40);
  assert.equal(result.segmentation.max, 30);
  // Sampling stops once the window closes -- a frame recorded afterward must not count.
  s.effect._updateDebugMetrics(999, 999, 0, 0, 999);
  assert.equal(result.frames, 3, 'result was already resolved; this is just confirming no mutation of the resolved object');
});

test('Phase 2c: runBenchmark reports blend and a residual that reconciles total against the sub-metrics', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};

  const benchPromise = s.effect.runBenchmark(0.05);

  // total=20, segmentation=10, readback=2, blend=3, compositing=4 -> residual = 20-10-2-3-4 = 1
  s.effect._updateDebugMetrics(20, 10, 2, 3, 4);

  const result = await benchPromise;

  assert.equal(result.blend.average, 3);
  assert.equal(result.residualMs, 1);
});

test('Phase 2c: frame loop gates the next render at max(MIN_TICK_GAP_MS, 1000/frameRate - elapsedRenderMs)', () => {
  const s = setup(true, { engine: 'v1' });

  // This test is about the formula's mechanics, not the governor's (now bottom-tier) starting fps
  // -- pin the fps lever at the top so 1000/30 below is meaningful.
  s.effect._perfFpsCap = 30;

  // Before any render, the gate is still the unchanged 1000/30 -- _lastRenderElapsedMs starts at 0.
  assert.ok(Math.abs(s.effect._nextTickDelayMs() - (1000 / 30)) < 0.001);

  // A fast (near-0ms) render should schedule close to the full 1000/frameRate period.
  s.effect._lastRenderElapsedMs = 2;
  assert.ok(Math.abs(s.effect._nextTickDelayMs() - ((1000 / 30) - 2)) < 0.001);

  // A render slower than one whole frame period must not produce a negative delay -- it clamps
  // to MIN_TICK_GAP_MS (4), not to 0 or a negative number.
  s.effect._lastRenderElapsedMs = 50;
  assert.equal(s.effect._nextTickDelayMs(), 4);

  // A non-default frameRate (e.g. 15fps from a throttled camera) is honoured too.
  s.effect._frameRate = 15;
  s.effect._lastRenderElapsedMs = 0;
  assert.ok(Math.abs(s.effect._nextTickDelayMs() - (1000 / 15)) < 0.001);
});

test('Phase 2c: MIN_TICK_GAP_MS floors the delay so a very fast render never schedules a ~0ms tick', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  // Pinned at the top fps tier so 1000/30 - 50 is actually negative, exercising the floor -- at
  // the (now bottom-tier) default fps of 15, 1000/15 - 50 stays positive and never needs it.
  s.effect._perfFpsCap = 30;

  // Simulate a render that took longer than one whole frame period -- 1000/30 - 50 would be
  // negative without the floor.
  s.effect._lastRenderElapsedMs = 50;
  const delay = s.effect._nextTickDelayMs();

  assert.equal(delay, 4);
});

test('Phase 2c: getTotalFrameCount is monotonic and does not reset across runBenchmark calls', async () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};

  const before = s.effect.getTotalFrameCount();

  s.effect._renderMask();
  s.effect._renderMask();
  assert.equal(s.effect.getTotalFrameCount(), before + 2);

  await s.effect.runBenchmark(0.01);
  // A benchmark window resets _benchSamples/_benchDroppedFrames but must never reset the
  // monotonic counter -- it only ever goes up.
  s.effect._renderMask();
  assert.equal(s.effect.getTotalFrameCount(), before + 3);
});

// ---------------------------------------------------------------------------------------------
// Phase 3 (Virtual Background & PiP Performance Audit, section 3's own instrumentation gaps +
// section 6's canvas-compositing audit): adds the missing camera-input-vs-segmentation FPS split
// and frame-age/staleness measurement, and removes three confirmed (by reading the code, not by
// live profiling) redundant per-frame costs -- a MediaStreamTrack.getSettings() call made twice
// every frame for a fallback value that is, in practice, never actually used once the camera is
// live; a fresh canvas.getContext('2d') call every frame for a canvas that already has one; and a
// full mask-sized typed-array allocation every MediaPipe frame where a reused scratch buffer works
// identically. None of these change what gets drawn -- see 'Phase 2b SAFETY: the normal draw path
// is byte-for-byte identical' above, which still passes unchanged after these edits.
// ---------------------------------------------------------------------------------------------

test('Phase 3: getCameraInputFrameCount counts every triggered video frame, even ones the governor-cadence gate skips', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};

  const inputBefore = s.effect.getCameraInputFrameCount();
  const renderedBefore = s.effect.getTotalFrameCount();

  // Two frame callbacks fired back-to-back, real wall-clock time apart by far less than the
  // governor's own cadence gate (tens of ms at the bottom tier) -- the second one must still be
  // COUNTED as a real camera frame even though _nextTickDelayMs() causes _renderMask() itself to
  // skip actually rendering it.
  s.triggerVideoFrame();
  s.triggerVideoFrame();

  assert.equal(s.effect.getCameraInputFrameCount(), inputBefore + 2, 'every genuinely new camera frame must be counted, regardless of the governor');
  assert.ok(s.effect.getTotalFrameCount() < renderedBefore + 2, 'the second frame must actually have been skipped by the cadence gate for this test to be meaningful');
});

test('Phase 3: getFrameAgeMs is 0 before any successful render, and a small non-negative number right after one', () => {
  const s = setup(true, { engine: 'v1' });

  assert.equal(s.effect.getFrameAgeMs(), 0, 'nothing has ever been successfully composited yet');
  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect._renderMask();
  const age = s.effect.getFrameAgeMs();

  assert.ok(age >= 0 && age < 1000, `expected a small age right after rendering, got ${age}ms`);
});

test('Phase 3: getFrameAgeMs does NOT advance on a frame that failed segmentation (output canvas genuinely did not get newer)', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { throwOnSegment: true } });

  s.effect._renderMask();
  assert.equal(s.effect.getFrameAgeMs(), 0, 'a failed-segmentation frame must not count as a successful render -- see _renderMask\'s own skip-compositing-on-failure comment');
});

test('Phase 3: _lastOverlayMetrics exposes the new cameraInputFps/segmentationFps/frameAgeMs diagnostics (audit section 11 gap)', () => {
  const s = setup(true, { engine: 'mediapipe-cpu' });

  s.setOverlayDebug(true);
  s.effect._renderMask();
  assert.ok(s.effect._lastOverlayMetrics);
  assert.equal(typeof s.effect._lastOverlayMetrics.cameraInputFps, 'number');
  assert.equal(typeof s.effect._lastOverlayMetrics.segmentationFps, 'number');
  assert.equal(typeof s.effect._lastOverlayMetrics.frameAgeMs, 'number');
});

test('Phase 3: runPostProcessing/_captureSourceFrame do not call track.getSettings() when the video element already reports real dimensions', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  let getSettingsCalls = 0;
  const realGetSettings = s.track.getSettings.bind(s.track);

  s.track.getSettings = (...args) => { getSettingsCalls++; return realGetSettings(...args); };
  s.effect._renderMask();
  s.effect._renderMask();
  assert.equal(getSettingsCalls, 0, 'the mock video element always reports real videoWidth/videoHeight (like a live camera), so getSettings() is pure fallback and must never be reached on this path');
});

test('Phase 3: runPostProcessing falls back to track.getSettings() when the video element has no dimensions yet', () => {
  const s = setup(true, { engine: 'v1' });

  // startEffect() already set .width/.height (the actual <video> element attributes, read FIRST
  // by runPostProcessing via sourceFrame.width/height) to the real native size -- all four
  // dimension sources must be cleared to actually force the getSettings() fallback.
  s.video.videoWidth = 0;
  s.video.videoHeight = 0;
  s.video.width = 0;
  s.video.height = 0;
  let getSettingsCalls = 0;
  const realGetSettings = s.track.getSettings.bind(s.track);

  s.track.getSettings = (...args) => { getSettingsCalls++; return realGetSettings(...args); };
  // Call directly (bypassing the normal readyState>=2 gate this scenario couldn't reach through
  // _renderMask in practice) to prove the fallback itself still works correctly when needed.
  s.effect.runPostProcessing();
  assert.ok(getSettingsCalls >= 1, 'the fallback must still actually run when there is no other source of the camera dimensions');
});

test('Phase 3: the blur-branch canvas context is cached (same object) across frames, not re-fetched via getContext every time', () => {
  const s = setup(true, { engine: 'v1' }); // default background is blur (see setup's own constructor call)

  s.effect.runPostProcessing();
  const ctxAfterFirst = s.effect._blurCanvasCtx;

  assert.ok(ctxAfterFirst, 'must have cached a context after the first blur-path render');
  s.effect.runPostProcessing();
  assert.equal(s.effect._blurCanvasCtx, ctxAfterFirst, 'the SAME context object must still be in use on a later frame');
});

test('Phase 3: _fillSpatialHoles reuses its scratch buffer across frames of the same mask size (no new allocation)', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 4, maskHeight: 3 } });

  s.effect._renderMask();
  const scratchAfterFirst = s.effect._fillSpatialHolesScratch;

  assert.ok(scratchAfterFirst, 'a scratch buffer must exist after the first MediaPipe frame (which calls _fillSpatialHoles via _blendMaskValues)');
  s.effect._renderMask();
  assert.equal(s.effect._fillSpatialHolesScratch, scratchAfterFirst, 'the SAME Uint8ClampedArray must be reused for a frame at the same mask size, not reallocated');
});

// ---------------------------------------------------------------------------------------------
// Phase 4 (Virtual Background & PiP Performance Audit): the stall watchdog -- an independent
// timer that detects the requestVideoFrameCallback loop silently failing to reschedule itself (a
// rare but real edge case this codebase had no way to notice before), using the Phase 3
// _cameraInputFrameCount counter as its signal. The real setInterval/clearInterval are mocked as
// harmless no-ops in this harness (see the './backgroundImageCache'-adjacent comment above the vm
// context construction) -- these tests call s.effect._checkForStall() directly instead of waiting
// on a real 4-second timer, the same "control the timed boundary by hand" approach already used
// for the governor's fake-clock tests and the image-cache mock's manual resolve/reject.
// ---------------------------------------------------------------------------------------------

test('Phase 4: stall watchdog re-registers the frame loop when no new camera frame arrived since the last check', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  // Establish a baseline at the CURRENT camera input count (as _startStallWatchdog does at
  // startEffect time), then simulate a full watchdog interval passing with NO new camera frames.
  s.effect._watchdogLastCameraInputFrameCount = s.effect.getCameraInputFrameCount();
  const handleBefore = s.effect._rvfcHandle;

  assert.equal(s.effect._watchdogRecoveryCount, 0);
  s.effect._checkForStall();
  assert.equal(s.effect._watchdogRecoveryCount, 1, 'a stall (no camera input progress) must be detected and a recovery attempted');
  assert.notEqual(s.effect._rvfcHandle, handleBefore, 'the frame callback must actually have been re-registered (a new handle), not just silently left alone');
});

test('Phase 4: stall watchdog does nothing when camera frames ARE still arriving', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.effect._watchdogLastCameraInputFrameCount = s.effect.getCameraInputFrameCount();
  s.triggerVideoFrame(); // a real new camera frame arrives before the next watchdog check
  const handleBefore = s.effect._rvfcHandle;

  s.effect._checkForStall();
  assert.equal(s.effect._watchdogRecoveryCount, 0, 'no recovery should be attempted -- the loop is demonstrably still working');
  assert.equal(s.effect._rvfcHandle, handleBefore, 'the frame callback must not be needlessly re-registered when nothing is actually wrong');
});

test('Phase 4: stall watchdog is inert once the effect has given up or been stopped', () => {
  const s = setup(true, { engine: 'v1' });

  s.effect._watchdogLastCameraInputFrameCount = s.effect.getCameraInputFrameCount();
  s.effect.stopEffect();
  assert.doesNotThrow(() => s.effect._checkForStall());
  assert.equal(s.effect._watchdogRecoveryCount, 0, 'a deliberately stopped effect is not a stall -- the watchdog must not try to resurrect it');
});

test('Phase 4: _startStallWatchdog is idempotent across repeated startEffect() calls on the same instance (no leaked intervals)', () => {
  const s = setup(true, { engine: 'v1' });
  const handleAfterFirstStart = s.effect._watchdogIntervalHandle;

  assert.ok(handleAfterFirstStart !== null);
  // A device switch mid-call re-runs startEffect() on this SAME instance (see useJitsiMeeting.ts's
  // applyVirtualBackgroundToTrack) -- must not leave the previous interval running underneath a
  // second one.
  s.effect.startEffect({ getVideoTracks: () => [ s.track ] });
  assert.ok(s.effect._watchdogIntervalHandle !== null, 'a fresh interval must exist after the second startEffect() call');
});

test('MediaPipe is fed the model-native fixed 256x144 canvas, not a raw camera frame', () => {
  // The pinned landscape model's native grid is 256x144. A 512x288 input canvas is only a
  // development A/B experiment; it must not become the unmeasured production default.
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 256, maskHeight: 144 } });

  s.effect._renderMask();

  const videoArg = s.mediaPipeCalls;

  assert.equal(videoArg.segmentForVideo, 1);
  assert.equal(s.effect._options.width, 256);
  assert.equal(s.effect._options.height, 144);
  assert.ok(s.effect._mediaPipeInputCanvas, 'a reusable MediaPipe input canvas must have been created');
  assert.equal(s.effect._mediaPipeInputCanvas.width, 256);
  assert.equal(s.effect._mediaPipeInputCanvas.height, 144);
});

test('Phase 2c: MediaPipe blend timing is measured separately from segmentation/readback', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 4, maskHeight: 3 } });

  s.effect._runMediaPipeInference();
  assert.equal(typeof s.effect._lastMediaPipeBlendMs, 'number');
  assert.ok(s.effect._lastMediaPipeBlendMs >= 0);
});
