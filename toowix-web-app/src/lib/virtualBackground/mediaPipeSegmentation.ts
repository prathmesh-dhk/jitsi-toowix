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

// This was 'v1' through Phase 2/3 -- mediapipe-gpu was kept strictly opt-in, based on a concern
// (see mediapipe/mediapipe#5681) that GPU-backed mask readback could cost 80-100ms/frame, far
// past budget, and on this repo's own bench/REPORT.md flagging real caveats (workstation-GPU-only
// measurements, an unexplained headed-run slowdown, an untested tab-visibility-resume case).
// Promoted to default after this session's real-device validation (motion-adaptive smoothing,
// spatial hole-fill, higher-res segmentation, edge sharpening -- all MediaPipe-only, see
// JitsiStreamBackgroundEffect.ts) measurably fixed the ghosting/hole/edge-softness issues V1 has
// no equivalent fix for, and this repo's actual measured readback cost (8-25ms in bench/REPORT.md)
// was well under the cited worst case. The bench report's caveats about untested typical
// (non-workstation) hardware and long-session robustness still apply and haven't been separately
// re-validated -- V1 remains the automatic fallback (see _fallBackToV1/_giveUp in
// JitsiStreamBackgroundEffect.ts) if MediaPipe fails to load or fails repeatedly mid-call.
// REVERTED to 'v1' on 2026-09-30. mediapipe-gpu was promoted to default for desktop earlier
// today; shortly after, the SAME desktop user hit two real, live symptoms in the same session:
// (1) "Connection interrupted -- attempting to reconnect" repeatedly, even on a reported 300Mbps
// wired connection, with the call's own "Adjusting video quality" indicator active -- consistent
// with LOCAL CPU/GPU contention (the effect's segmentation/compositing work starving the tab's
// own WebRTC encode/pacing threads) being misread as a network problem, not an actual network
// issue (JVB-side server/network health was checked directly and was fine). (2) A confirmed,
// separate real bug (see JitsiStreamBackgroundEffect.ts's _giveUp/_drawRawPassthroughFrame) where
// a struggling device left the outgoing Picture-in-Picture frame black -- itself evidence this
// specific device was hitting the performance governor's floor-exhausted/give-up path, i.e.
// genuinely too slow for the engine that was, until today, this user's default. Reverting the
// DEFAULT back to 'v1' (proven for this entire engagement with no history of either symptom) is
// the safe, immediately-reversible mitigation while both issues are still being isolated -- the
// MediaPipe engines and their quality fixes (motion-adaptive smoothing, spatial hole-fill, edge
// sharpening) remain fully intact and selectable via ?bgEngine=mediapipe-cpu/mediapipe-gpu, not
// deleted, just no longer chosen automatically until this is re-validated on ordinary hardware.
const DEFAULT_SEGMENTATION_ENGINE: SegmentationEngine = 'v1';
// Kept 'v1' too (was already the safer choice here since the mediapipe-gpu real-device finding
// below) -- unaffected by today's revert above, restated for clarity now that BOTH platforms
// default to 'v1' and the distinction between this constant and the one above is less obvious.
// Real-device finding (2026-09-30, Android Chrome): mediapipe-gpu's real-device validation for
// the commit above was desktop-only. On an Android phone, the GPU delegate either failed to
// initialize or failed repeatedly mid-call (server logs showed the MediaPipe GPU wasm/model load
// immediately followed ~30-45s later by V1's own wasm/model loading -- the automatic mid-call
// fallback silently kicking in), leaving the user on plain V1 with none of the ghosting/hole-fill
// fixes those are meant to provide.
const DEFAULT_SEGMENTATION_ENGINE_MOBILE: SegmentationEngine = 'v1';

function isMobileDevice(): boolean {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  } catch {
    return false;
  }
}

// Override, e.g. from a browser console: localStorage.setItem('toowix_bg_engine', 'v1'), or via
// the ?bgEngine= URL param (see readSegmentationEngineOverride below) -- useful for comparing
// against V1 or forcing CPU delegate for debugging.
const SEGMENTATION_ENGINE_STORAGE_KEY = 'toowix_bg_engine';

function isValidEngine(value: string | null): value is SegmentationEngine {
  return value === 'v1' || value === 'mediapipe-cpu' || value === 'mediapipe-gpu';
}

export function readSegmentationEngineOverride(): SegmentationEngine {
  try {
    // A URL param (?bgEngine=mediapipe-gpu) is checked FIRST and, if present, written into
    // localStorage so it survives a reload without the param still in the URL -- this exists
    // because the console-command flow (localStorage.setItem(...) typed by hand, in whichever tab
    // happens to be focused, before a reload) is easy to get wrong in a way that silently does
    // nothing (wrong tab/origin, private window, a reload racing the command) and gives no
    // feedback when it does. A URL param can't land in the wrong place -- it's part of the exact
    // page being loaded.
    if (typeof location !== 'undefined') {
      const fromUrl = new URLSearchParams(location.search).get('bgEngine');

      if (isValidEngine(fromUrl)) {
        localStorage.setItem(SEGMENTATION_ENGINE_STORAGE_KEY, fromUrl);

        return fromUrl;
      }
    }
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SEGMENTATION_ENGINE_STORAGE_KEY) : null;

    if (isValidEngine(stored)) {
      return stored;
    }
  } catch {
    // localStorage can be unavailable (private mode, a restricted embed) -- the default is safe.
  }

  return isMobileDevice() ? DEFAULT_SEGMENTATION_ENGINE_MOBILE : DEFAULT_SEGMENTATION_ENGINE;
}

// Dev-only A/B override for MediaPipe's segmentation source canvas. Production uses the pinned
// model's native 256x144 grid; 512 is available only to measure whether upscaling before model
// preprocessing has any real visual benefit on a webcam. ?bgSegSize=256 or ?bgSegSize=512
// (or localStorage.setItem('toowix_bg_seg_size', '256')),
// same URL-param-first/write-through pattern as readSegmentationEngineOverride above. Gated out of
// production builds -- same reasoning as backgroundDebugTools.ts's isProductionBuild.
export type MediaPipeSegSize = 256 | 512;
const SEG_SIZE_STORAGE_KEY = 'toowix_bg_seg_size';

function isProductionBuild(): boolean {
  try {
    return Boolean((import.meta as any)?.env?.PROD);
  } catch {
    return false;
  }
}

function isValidSegSize(value: string | null): value is '256' | '512' {
  return value === '256' || value === '512';
}

// Returns null when no override is set (or in production) -- the caller (JitsiStreamBackground
// Effect.ts) falls back to its own native 256x144 MEDIAPIPE_SEG_WIDTH/HEIGHT default in that case, so
// this function never needs to know or duplicate that default itself.
export function readMediaPipeSegSizeOverride(): MediaPipeSegSize | null {
  if (isProductionBuild()) return null;
  try {
    if (typeof location !== 'undefined') {
      const fromUrl = new URLSearchParams(location.search).get('bgSegSize');

      if (isValidSegSize(fromUrl)) {
        localStorage.setItem(SEG_SIZE_STORAGE_KEY, fromUrl);

        return Number(fromUrl) as MediaPipeSegSize;
      }
    }
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SEG_SIZE_STORAGE_KEY) : null;

    if (isValidSegSize(stored)) {
      return Number(stored) as MediaPipeSegSize;
    }
  } catch {
    // localStorage can be unavailable (private mode, a restricted embed) -- no override.
  }

  return null;
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
