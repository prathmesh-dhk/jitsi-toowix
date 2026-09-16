// Trimmed port of jitsi-meet's stream-effects/virtual-background/index.ts factory -- loads the
// TFLite WASM module + segmentation model once (cached across calls) and constructs the effect.
// No Redux here (this app doesn't use it) -- callers get a rejected promise on failure instead
// of a dispatched notification action.
import JitsiStreamBackgroundEffect, { IVirtualBackground } from './JitsiStreamBackgroundEffect';

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

export async function createVirtualBackgroundEffect(
    virtualBackground: IVirtualBackground
): Promise<JitsiStreamBackgroundEffect> {
  if (typeof WebAssembly !== 'object') {
    throw new Error('WebAssembly is not supported in this browser');
  }

  const { tflite } = await loadTfliteOnce();

  return new JitsiStreamBackgroundEffect(tflite, virtualBackground);
}
