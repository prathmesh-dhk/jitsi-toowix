// Bench harness -- imports the REAL, unmodified virtual-background modules from the app's own
// source tree (no copy, no reimplementation). Built through this folder's own Vite config so it
// goes through a real bundler pass, without touching the app's own vite.config.ts/package.json.
import { createVirtualBackgroundEffect } from '../../src/lib/virtualBackground/createVirtualBackgroundEffect';

declare global {
  interface Window {
    __benchEffect: any;
    __benchReady: boolean;
    __benchError: string | null;
    __benchStream: MediaStream | null;
    __benchToggle: () => MediaStream;
    // Phase 2c Step 2/4 instrumentation -- bench-harness-only, never touches product code.
    // __benchTickTimestamps: performance.now() at the start of every _renderMask() call, used by
    // run-bench.mjs to compute real tick spacing (for the headed-anomaly investigation) without
    // adding any timing code to JitsiStreamBackgroundEffect.ts itself. Capped so a long headed
    // run doesn't grow this unboundedly.
    __benchTickTimestamps: number[];
    __benchVisibilityLog: Array<{ t: number; hidden: boolean; visibilityState: string }>;
  }
}

const statusEl = document.getElementById('status')!;
const videoEl = document.getElementById('self') as HTMLVideoElement;

function setStatus(text: string) {
  statusEl.textContent = text;
  // eslint-disable-next-line no-console
  console.log('[bench]', text);
}

window.__benchReady = false;
window.__benchError = null;
window.__benchTickTimestamps = [];
window.__benchVisibilityLog = [];

document.addEventListener('visibilitychange', () => {
  window.__benchVisibilityLog.push({ t: performance.now(), hidden: document.hidden, visibilityState: document.visibilityState });
  if (window.__benchVisibilityLog.length > 200) window.__benchVisibilityLog.shift();
});

(async () => {
  try {
    setStatus('requesting fake camera...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

    setStatus('creating virtual background effect (blur)...');
    const effect = await createVirtualBackgroundEffect({ backgroundType: 'blur', blurValue: 25 });

    setStatus('starting effect...');
    const outputStream = effect.startEffect(stream);

    videoEl.srcObject = outputStream;
    await videoEl.play().catch(() => { /* autoplay may need a user gesture in some contexts */ });

    // Wrap (not edit) _renderMask purely to timestamp calls for the bench harness -- the real
    // method still runs exactly as-is via originalRenderMask(); this never changes product code.
    const originalRenderMask = effect._renderMask.bind(effect);

    effect._renderMask = () => {
      window.__benchTickTimestamps.push(performance.now());
      if (window.__benchTickTimestamps.length > 2000) window.__benchTickTimestamps.shift();

      return originalRenderMask();
    };

    window.__benchEffect = effect;
    window.__benchStream = stream;
    // Bench-only helper (Step 4 stability check: 20x off/on) -- calls the real, unmodified
    // stopEffect()/startEffect() on the same effect instance, exactly what the app itself does
    // when a user turns a background off then on again.
    window.__benchToggle = () => {
      effect.stopEffect();

      return effect.startEffect(stream);
    };
    window.__benchReady = true;
    setStatus(`ready -- engine=${effect._engine}`);
  } catch (err: any) {
    window.__benchError = err?.message || String(err);
    setStatus(`ERROR: ${window.__benchError}`);
    // eslint-disable-next-line no-console
    console.error('[bench] failed to start', err);
  }
})();
