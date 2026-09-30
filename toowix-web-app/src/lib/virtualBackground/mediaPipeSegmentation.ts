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

// History: 'v1' through Phase 2/3 (mediapipe-gpu strictly opt-in, over concerns about GPU-backed
// mask readback cost -- see mediapipe/mediapipe#5681). Promoted to a blanket default for ALL
// desktop users on 2026-09-30 after this session's real-device validation fixed real quality
// issues V1 has no equivalent fix for -- then REVERTED back to a blanket 'v1' hours later, the
// same day, when that blanket default caused two real, live symptoms for a desktop user with an
// ordinary (non-workstation) machine: "Connection interrupted" even on a good wired connection
// (consistent with local CPU/GPU contention starving the tab's own WebRTC threads, not an actual
// network problem -- JVB/server health was checked directly and was fine), and a confirmed black
// Picture-in-Picture frame from the performance governor's give-up path -- i.e. that SPECIFIC
// device was genuinely too weak for the engine every desktop user was being defaulted to.
//
// Neither blanket choice is right: a real discrete GPU should get mediapipe-gpu (its quality
// fixes, at a cost this repo's own bench/REPORT.md measured as small on capable hardware); a
// weak/integrated GPU or a software-rendered browser should NOT be defaulted into that same cost.
// detectDefaultEngine() below replaces both blanket constants with an actual one-time capability
// probe (WEBGL_debug_renderer_info's unmasked renderer string) so each device gets routed to the
// engine it can actually run well, instead of every user sharing one guess. The existing runtime
// governor (duty-cycle resolution/fps stepping, mid-call fallback, give-up -- see
// JitsiStreamBackgroundEffect.ts) is UNCHANGED and still adapts live within whichever engine this
// picks; this only changes which engine a session STARTS on.
const FALLBACK_ENGINE: SegmentationEngine = 'v1';

// Known software/CPU-emulated WebGL renderer strings -- these report a WebGL context that WORKS,
// but every draw call is emulated in software (SwiftShader, llvmpipe/Mesa's software rasterizer,
// Windows' "Microsoft Basic Render Driver", a headless/virtualized GPU with no real driver). A
// session on one of these has no real GPU to give mediapipe-gpu's near-flat segmentation cost --
// it would pay the SAME (or worse) cost as CPU delegate for none of the benefit, so it's treated
// as "no real GPU" here even though the browser itself reports WebGL as available.
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|software|microsoft basic render|vmware|virtualbox|basic render driver/i;

function isMobileDevice(): boolean {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  } catch {
    return false;
  }
}

// One-time, synchronous, best-effort GPU capability probe. Creates a throwaway canvas purely to
// query WEBGL_debug_renderer_info -- never kept, never rendered to, costs a few ms at most and
// only runs once (cached below). Returns:
//  - 'gpu'  -- a real (non-software) GPU renderer string was found.
//  - 'cpu'  -- WebGL is available but the renderer looks software-emulated, OR the unmasked
//              renderer string couldn't be read (some privacy-hardened browsers block the
//              extension entirely) -- ambiguous cases default to the SAFER (no-GPU) answer.
//  - 'none' -- no WebGL context could be created at all.
export function probeGpuTier(): 'cpu' | 'gpu' | 'none' {
  try {
    if (typeof document === 'undefined') return 'none';
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;

    if (!gl) return 'none';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    if (!debugInfo) return 'cpu'; // WebGL works, but can't identify the renderer -- assume no real GPU.
    const renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');

    if (!renderer || SOFTWARE_RENDERER_PATTERN.test(renderer)) return 'cpu';

    return 'gpu';
  } catch {
    return 'cpu'; // Detection itself failing is not evidence of a real GPU -- stay on the safe side.
  }
}

let cachedDefaultEngine: SegmentationEngine | null = null;

// The actual per-device default, used only when no explicit override (URL param/localStorage) is
// set -- see readSegmentationEngineOverride below. Mobile keeps the confirmed-safe 'v1' outright
// (real-device evidence below showed the GPU delegate failing there regardless of what WebGL
// itself reports); desktop gets routed by the real capability probe. Cached after the first call
// since the probe result cannot change within a single page session.
export function detectDefaultEngine(): SegmentationEngine {
  if (cachedDefaultEngine) return cachedDefaultEngine;
  if (isMobileDevice()) {
    // Real-device finding (2026-09-30, Android Chrome): the GPU delegate either failed to
    // initialize or failed repeatedly mid-call (server logs showed the MediaPipe GPU wasm/model
    // load immediately followed ~30-45s later by V1's own wasm/model loading -- the automatic
    // mid-call fallback silently kicking in). Not re-tested against mediapipe-cpu specifically on
    // mobile, so 'v1' (the confirmed-safe path) stays the mobile default rather than guessing.
    cachedDefaultEngine = 'v1';

    return cachedDefaultEngine;
  }
  const tier = probeGpuTier();

  cachedDefaultEngine = tier === 'gpu' ? 'mediapipe-gpu' : tier === 'cpu' ? 'mediapipe-cpu' : FALLBACK_ENGINE;

  return cachedDefaultEngine;
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

  return detectDefaultEngine();
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
