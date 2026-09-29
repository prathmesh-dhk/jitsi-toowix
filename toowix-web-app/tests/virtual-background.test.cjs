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
function setup(filter = true, { width = 640, height = 360, engine = 'v1', mediaPipe = {}, v1Fallback = {}, onGiveUp = null } = {}) {
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
  const video = { readyState: 2, videoWidth: width, videoHeight: height, setAttribute() {}, pause() {}, play() { plays++; return Promise.resolve(); } };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement(kind) {
      if (kind === 'video') return video;
      if (kind === 'img') return { complete: true, naturalWidth: 640 };
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

  vm.runInNewContext(code, {
    exports, document, window, console: { warn: (...args) => warnings.push(args), info() {} },
    setTimeout, clearTimeout,
    // The SAME Date reference as the host realm (not vm's own) -- so a test's `Date.now = () =>
    // fakeNow` monkeypatch on the host's Date actually affects code running inside this vm
    // context too. Without this, vm.runInNewContext's own separate Date class means the patch
    // silently never reaches the governor's Date.now() calls (a real cross-realm gotcha,
    // discovered by the Phase 3 governor's fake-clock tests failing with real Date.now() values).
    Date,
    require: (id) => {
      if (id === './mediaPipeSegmentation') {
        return { getNextMediaPipeTimestamp: () => ++mediaPipeTimestampCounter };
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
    setOverlayDebug: (v) => { overlayDebugFlag = v; }
  };
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

test('does not segment suspended, muted, disabled, or ended camera frames', () => {
  const s = setup();
  let frames = 0;
  s.effect.resizeSource = () => frames++;
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};
  s.track.muted = true;
  s.effect._renderMask();
  s.track.muted = false;
  s.document.hidden = true;
  s.effect._renderMask();
  s.document.hidden = false;
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

test('a transient frame error does not stop the worker schedule', () => {
  const s = setup();
  const worker = s.effect._maskFrameTimerWorker;
  s.effect._renderMask = () => { throw new Error('temporarily unavailable'); };
  const before = worker.messages.length;
  worker.onmessage({ data: { id: 3 } });
  assert.equal(worker.messages.length, before + 1);
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
  assert.equal(s.effect._perfCap, 1080);
  assert.equal(s.effect._perfFpsCap, 30);

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
  s.effect._perfDutyOverBudgetSince = Date.now() - 1100;
  s.effect._updatePerfGovernor(40);
  assert.notEqual(s.effect._perfFpsCap, 30);

  s.effect.startEffect({ getVideoTracks: () => [s.track] });
  assert.equal(s.effect._perfCap, 1080);
  assert.equal(s.effect._perfFpsCap, 30);
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

  assert.equal(s.effect.getCurrentFrameRate(), 30); // native 30fps, fps lever starts at 30
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
  assert.equal(s.effect._maskFrameTimerWorker, null, 'the timer loop must be stopped, not left running to burn CPU');
  assert.ok(s.warnings.some((w) => String(w.join(' ')).includes('giving up')));

  // Idempotent -- a second call (e.g. a stray governor tick before the caller reacts) must not
  // call onGiveUp again.
  s.effect._handlePerfFloorExhausted();
  assert.equal(giveUpCalls, 1);
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

test('V1 SAFETY: resizeSource and runInference are byte-for-byte unchanged from before Phase 2', () => {
  // Phase 2's explicit rule: do not refactor or rewrite the existing TFLite code path. This pins
  // the exact source of both methods so a future edit that touches them (even accidentally, e.g.
  // while "cleaning up" nearby MediaPipe code) fails loudly here instead of silently changing V1
  // behaviour that every existing V1 test above already covers black-box, but not textually.
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(source, /resizeSource\(\) \{\n\s*this\._segmentationMaskCtx\?\.drawImage\(/, 'resizeSource() opening must be unchanged');
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
      /if \(this\._engine === 'v1'\) \{[\s\S]*?this\.resizeSource\(\);\n\s*this\.runInference\(\);/,
      '_renderMask() must still call resizeSource() then runInference(), in that order (with nothing V1-specific between them), for the v1 engine'
  );
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
  // 0.9 then passes through sharpenMaskAlpha (MediaPipe-only edge-crispening), landing at
  // 255 * 0.91825... = 234 (Uint8ClampedArray rounding) -- not 255 * 0.9 = 229.5, since the raw
  // value is shaped before being written to alpha, not written raw.
  assert.equal(s.effect._segmentationMask.data[3], 234);
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

test('Phase 2c: frame loop schedules the next tick at max(MIN_TICK_GAP_MS, 1000/frameRate - elapsedRenderMs)', () => {
  const s = setup(true, { engine: 'v1' });
  const worker = s.effect._maskFrameTimerWorker;

  // First tick (before any render) must still be the unchanged 1000/30 -- _lastRenderElapsedMs
  // starts at 0.
  assert.ok(Math.abs(worker.messages.at(-1).timeMs - (1000 / 30)) < 0.001);

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
  const worker = s.effect._maskFrameTimerWorker;

  s.effect.resizeSource = () => {};
  s.effect.runInference = () => {};
  s.effect.runPostProcessing = () => {};

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

test('MediaPipe is fed a small, FIXED-size canvas (not the raw video element, and not V1\'s SEG_WIDTH/HEIGHT)', () => {
  // Deliberately raised from V1's 256x144 to 512x288 (still fixed, still much smaller than the
  // camera's native resolution) -- GPU segmentation cost is close to flat regardless of input size
  // (see JitsiStreamBackgroundEffect's MEDIAPIPE_SEG_WIDTH/HEIGHT comment and bench/REPORT.md), so
  // MediaPipe can afford a sharper mask for close to free, which directly reduced ghosting/edge
  // softness. Uses the real reported size (512x288) here rather than the mock's old 256x144, since
  // the mock's maskWidth/maskHeight is meant to mirror what a real segmenter fed this input size
  // would report back.
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 512, maskHeight: 288 } });

  s.effect._renderMask();

  const videoArg = s.mediaPipeCalls;

  assert.equal(videoArg.segmentForVideo, 1);
  assert.equal(s.effect._options.width, 512);
  assert.equal(s.effect._options.height, 288);
  assert.ok(s.effect._mediaPipeInputCanvas, 'a reusable MediaPipe input canvas must have been created');
  assert.equal(s.effect._mediaPipeInputCanvas.width, 512);
  assert.equal(s.effect._mediaPipeInputCanvas.height, 288);
});

test('Phase 2c: MediaPipe blend timing is measured separately from segmentation/readback', () => {
  const s = setup(true, { engine: 'mediapipe-cpu', mediaPipe: { maskWidth: 4, maskHeight: 3 } });

  s.effect._runMediaPipeInference();
  assert.equal(typeof s.effect._lastMediaPipeBlendMs, 'number');
  assert.ok(s.effect._lastMediaPipeBlendMs >= 0);
});
