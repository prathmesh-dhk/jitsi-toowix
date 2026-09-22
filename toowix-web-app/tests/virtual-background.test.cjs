const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual effect with browser primitives mocked; not an iPhone rendering test.
function setup(filter = true) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const draws = [];
  const makeContext = () => ({ ...(filter ? { filter: 'none' } : {}), drawImage: (...args) => draws.push(args), putImageData() {} });
  let plays = 0;
  const video = { readyState: 2, videoWidth: 640, videoHeight: 360, setAttribute() {}, pause() {}, play() { plays++; return Promise.resolve(); } };
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
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, enabled: true, getSettings: () => ({ width: 640, height: 360, frameRate: 30 }) });
  const exports = {};
  vm.runInNewContext(code, {
    exports, document, window, console: { warn() {} },
    require: () => ({ SET_TIMEOUT: 1, CLEAR_TIMEOUT: 2, TIMEOUT_TICK: 3, timerWorkerScript: '' }),
    ImageData: class { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); } },
    Worker: class { messages = []; postMessage(message) { this.messages.push(message); } terminate() {} }
  });
  const effect = new exports.default({}, { backgroundType: 'blur', blurValue: 25 });
  effect.startEffect({ getVideoTracks: () => [track] });
  return { effect, track, document, window, draws, video, plays: () => plays };
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

test('retains native filter on browsers that support it', () => {
  const s = setup();
  s.effect.runPostProcessing();
  assert.equal(s.effect._outputCanvasCtx.filter, 'blur(25px)');
  assert.equal(s.draws.at(-1)[0], s.video);
});

test('a transient frame error does not stop the worker schedule', () => {
  const s = setup();
  const worker = s.effect._maskFrameTimerWorker;
  s.effect._renderMask = () => { throw new Error('temporarily unavailable'); };
  const before = worker.messages.length;
  worker.onmessage({ data: { id: 3 } });
  assert.equal(worker.messages.length, before + 1);
});
