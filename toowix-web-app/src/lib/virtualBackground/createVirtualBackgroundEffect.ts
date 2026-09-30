// Trimmed port of jitsi-meet's stream-effects/virtual-background/index.ts factory -- loads the
// TFLite WASM module + segmentation model once (cached across calls) and constructs the effect.
// No Redux here (this app doesn't use it) -- callers get a rejected promise on failure instead
// of a dispatched notification action.
//
// Phase 2 adds a second, opt-in segmentation engine (MediaPipe Tasks Vision) selected via
// readSegmentationEngineOverride() -- see mediaPipeSegmentation.ts for why that lives in its own
// module (avoiding a circular import with JitsiStreamBackgroundEffect.ts) and for the ownership
// rule on the cached MediaPipe segmenter. V1 (TFLite, below) remains the default and the engine
// this file falls back to if MediaPipe fails to initialize.
import JitsiStreamBackgroundEffect, { IVirtualBackground, ISegmentationEngineHandle } from './JitsiStreamBackgroundEffect';
import { loadMediaPipeSegmenter, readSegmentationEngineOverride } from './mediaPipeSegmentation';

// @ts-ignore -- plain Emscripten glue module, no types.
import createTFLiteModule from './tfliteModule.js';

const MODEL_URL = '/libs/selfie_segmentation_landscape.tflite';

let modulePromise: Promise<{ tflite: any }> | null = null;

function loadTfliteOnce(): Promise<{ tflite: any }> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const tflite = await createTFLiteModule({ locateFile: (path: string) => `/libs/${path}` });
      const modelResponse = await fetch(MODEL_URL);

      if (!modelResponse.ok) {
        throw new Error(`Failed to download the background segmentation model (HTTP ${modelResponse.status})`);
      }
      const modelBuffer = await modelResponse.arrayBuffer();

      tflite.HEAPU8.set(new Uint8Array(modelBuffer), tflite._getModelBufferMemoryOffset());
      tflite._loadModel(modelBuffer.byteLength);

      return { tflite };
    })().catch(err => {
      // Let the next caller retry instead of being stuck with a permanently-rejected cache.
      modulePromise = null;
      throw err;
    });
  }

  return modulePromise;
}

export interface ICreateVirtualBackgroundEffectOptions {
  // GO 3 give-up tier: called if the performance governor exhausts both levers with no cheaper
  // engine to fall back to (see JitsiStreamBackgroundEffect._giveUp). The effect has already
  // stopped itself (no more CPU spent) by the time this fires -- the caller is expected to
  // restore the raw camera track (never leave a black/frozen frame) and tell the user, and to not
  // automatically re-apply a background for GIVE_UP_COOLDOWN_MS's duration (5 minutes; the effect
  // itself does not enforce this, since a fresh instance from a device switch may legitimately
  // work -- see the comment on that constant).
  onGiveUp?: () => void;
  // Visible-fallback-toast requirement: called the moment the effect falls back to a different
  // engine than requested (init-time GPU/CPU failure, or a mid-call failure streak) -- unlike
  // onGiveUp, the effect keeps running (on the fallback engine), it's just not the one asked for.
  onFallback?: (reason: string) => void;
}

export async function createVirtualBackgroundEffect(
    virtualBackground: IVirtualBackground,
    options: ICreateVirtualBackgroundEffectOptions = {}
): Promise<JitsiStreamBackgroundEffect> {
  if (typeof WebAssembly !== 'object') {
    throw new Error('WebAssembly is not supported in this browser');
  }

  const requestedEngine = readSegmentationEngineOverride();
  // Diagnostics (see EDGE-STATUS task item 2): the real error that caused an init-time fallback
  // to v1, if one happened -- passed into the effect so the overlay/console can show it, not just
  // silently swallowed into a generic "falling back" log with no visibility past this call site.
  let initFallbackReason: string | null = null;

  if (requestedEngine === 'mediapipe-cpu' || requestedEngine === 'mediapipe-gpu') {
    const delegate = requestedEngine === 'mediapipe-gpu' ? 'GPU' : 'CPU';

    try {
      const mediaPipeSegmenter = await loadMediaPipeSegmenter(delegate);
      const engineHandle: ISegmentationEngineHandle = { engine: requestedEngine, mediaPipeSegmenter };

      return new JitsiStreamBackgroundEffect(engineHandle, virtualBackground, loadTfliteOnce, options.onGiveUp ?? null, null, options.onFallback ?? null);
    } catch (err) {
      // Creation failure (wasm/model download, GPU context unavailable, etc.) -- fall through to
      // V1 below rather than surface a broken call to the person selecting a background. A
      // DIFFERENT failure path -- MediaPipe creating successfully but then failing repeatedly
      // mid-call -- is handled inside JitsiStreamBackgroundEffect itself (see loadV1Fallback).
      const message = err instanceof Error ? err.message : String(err);

      initFallbackReason = `MediaPipe (${delegate}) failed to initialize: ${message}`;
      console.warn(`[VirtualBackground] ${initFallbackReason} -- falling back to V1.`);
    }
  }

  const { tflite } = await loadTfliteOnce();
  const engineHandle: ISegmentationEngineHandle = { engine: 'v1', tflite };

  return new JitsiStreamBackgroundEffect(engineHandle, virtualBackground, loadTfliteOnce, options.onGiveUp ?? null, initFallbackReason, options.onFallback ?? null);
}
