// Phase 2: the MediaPipe Tasks Vision segmentation engine -- an alternative to the V1 TFLite
// engine in JitsiStreamBackgroundEffect.ts, selectable only via the dev-only engine flag below
// (see readSegmentationEngineOverride). Kept in its own module, rather than inside
// createVirtualBackgroundEffect.ts or JitsiStreamBackgroundEffect.ts, specifically so BOTH of
// those files can import from here without creating a circular import between them (that
// createVirtualBackgroundEffect.ts already imports JitsiStreamBackgroundEffect.ts).
//
// Self-hosted, matching the existing TFLite engine's pattern -- no CDN loading at runtime. The
// wasm/ folder under /libs/mediapipe/wasm is a byte-for-byte copy of the pinned
// @mediapipe/tasks-vision npm package's own wasm/ folder (verified at build time by
// scripts/verify-mediapipe-assets.cjs; FilesetResolver requires these files be served unrenamed).
// The model file is a separately self-hosted, generation-pinned download -- see
// THIRD_PARTY_NOTICES.md for its exact source URL, pinned generation, size and SHA-256.
export type SegmentationEngine = 'v1' | 'mediapipe-cpu' | 'mediapipe-gpu';

const DEFAULT_SEGMENTATION_ENGINE: SegmentationEngine = 'v1';
// Dev-only override, e.g. from a browser console: localStorage.setItem('toowix_bg_engine',
// 'mediapipe-cpu'). 'mediapipe-gpu' must NEVER be reachable except through this explicit,
// manual override -- getAsFloat32Array() on a GPU-backed mask forces an expensive GPU-to-CPU
// readback (confirmed via @mediapipe/tasks-vision's own MPMask.getAsFloat32Array() doc comment,
// and independently by mediapipe/mediapipe#5681, which measured it at 80-100ms per frame -- far
// past this effect's entire per-frame budget), so it must never be picked automatically.
const SEGMENTATION_ENGINE_STORAGE_KEY = 'toowix_bg_engine';

export function readSegmentationEngineOverride(): SegmentationEngine {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SEGMENTATION_ENGINE_STORAGE_KEY) : null;

    if (stored === 'v1' || stored === 'mediapipe-cpu' || stored === 'mediapipe-gpu') {
      return stored;
    }
  } catch {
    // localStorage can be unavailable (private mode, a restricted embed) -- the default is safe.
  }

  return DEFAULT_SEGMENTATION_ENGINE;
}

const MEDIAPIPE_WASM_BASE_PATH = '/libs/mediapipe/wasm';
const MEDIAPIPE_MODEL_URL = '/libs/mediapipe/selfie_segmenter_landscape.tflite';

// Cached and shared across every effect instance for the tab's lifetime, keyed by delegate so a
// dev switching the override between CPU and GPU mid-session (page reload aside) doesn't reuse
// the wrong one -- same cache-and-retry-on-failure shape as loadTfliteOnce in
// createVirtualBackgroundEffect.ts.
//
// OWNERSHIP RULE: this cached segmenter is shared and is NEVER closed by an individual effect's
// stopEffect() or removal -- another effect instance (a device switch, a background reselected)
// may still be using it. Only a per-frame MPMask (via mask.close(), inside
// JitsiStreamBackgroundEffect's per-frame segmentation code) is owned by that single frame and
// closed every time, including on error paths. Nothing in this codebase currently closes the
// segmenter itself tab-wide; if that's ever needed (e.g. an explicit "free background engine
// memory" action), it must first confirm no effect instance is still using it.
const mediaPipeSegmenterPromises = new Map<'CPU' | 'GPU', Promise<any>>();

export async function loadMediaPipeSegmenter(delegate: 'CPU' | 'GPU'): Promise<any> {
  let promise = mediaPipeSegmenterPromises.get(delegate);

  if (!promise) {
    promise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_PATH);

      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false
      });
    })().catch((err) => {
      // Let the next caller (or the mid-call V1 fallback, on a later attempt) retry instead of
      // being stuck with a permanently-rejected cache.
      mediaPipeSegmenterPromises.delete(delegate);
      throw err;
    });
    mediaPipeSegmenterPromises.set(delegate, promise);
  }

  return promise;
}

// VIDEO running mode requires strictly increasing timestamps across every segmentForVideo() call
// made against a given (possibly shared/cached) segmenter -- tracked module-scope, not per effect
// instance, because the segmenter itself is shared: stopping one effect and starting another must
// not risk the new effect's first timestamp landing at or before the previous effect's last one.
// Always derived from performance.now() (never a per-effect frame counter, per design decision),
// bumped by 1ms on the rare case two calls land in the same millisecond.
let lastMediaPipeTimestampMs = 0;

export function getNextMediaPipeTimestamp(): number {
  const now = Math.round(performance.now());

  lastMediaPipeTimestampMs = now > lastMediaPipeTimestampMs ? now : lastMediaPipeTimestampMs + 1;

  return lastMediaPipeTimestampMs;
}
