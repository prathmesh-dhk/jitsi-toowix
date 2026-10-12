// Phase 2 (Virtual Background & PiP Performance Audit, docs/VIRTUAL_BACKGROUND_PIP_PERFORMANCE_
// AUDIT.md section 9): preloads and caches DECODED background images so switching between them is
// a synchronous reference swap instead of a fresh network fetch + decode on every selection --
// this was the one real, confirmed residual lag source Phase 1 left behind (image-switch decode
// wait, JitsiStreamBackgroundEffect.ts's old _renderMask skip-while-loading gate).
//
// Module-level (not per-effect-instance) and shared across the whole page session on purpose:
// the decoded pixel data for a given URL is identical no matter which JitsiStreamBackgroundEffect
// instance ends up drawing it, and every reader only ever calls drawImage() on these elements
// (read-only), never mutates them -- so sharing one decoded <img> across callers, including a
// device-switch creating a "new" effect instance mid-call, is safe and is the whole point.
import { isOverlayDebugEnabled } from './backgroundDebugTools';

// Bounded: the modal currently offers 7 presets; a little headroom covers a couple of custom/
// uploaded URLs without the cache growing without limit over a long session.
const MAX_CACHED_IMAGES = 10;

// Map iteration order is insertion order -- re-inserting a key on every cache hit (see touch())
// turns that into a cheap recency order, so eviction below is a real LRU, not just FIFO.
const cache = new Map<string, HTMLImageElement>();
// De-dupes concurrent preload requests for the SAME url (e.g. the modal's prefetch-on-open
// racing an actual click on that same preset) -- without this, both callers would create and
// decode their own separate <img>, wasting the exact per-frame-adjacent cost this cache exists to
// avoid ("avoid decoding duplicate images concurrently").
const inFlight = new Map<string, Promise<HTMLImageElement>>();

function touch(src: string, image: HTMLImageElement): void {
  cache.delete(src);
  cache.set(src, image);
  while (cache.size > MAX_CACHED_IMAGES) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function logDebug(message: string, extra?: Record<string, unknown>): void {
  if (!isOverlayDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug(`[VirtualBackground][imageCache] ${message}`, extra ?? {});
}

// Synchronous, no-op if not ready -- callers use this to decide between an instant swap and
// kicking off preloadBackgroundImage() for later.
export function getCachedBackgroundImage(src: string): HTMLImageElement | null {
  if (!src) return null;
  const image = cache.get(src);

  if (image && image.complete && image.naturalWidth > 0) {
    touch(src, image);

    return image;
  }

  return null;
}

// Resolves with a fully decoded <img> for `src`, reusing the cache (and any identical in-flight
// request) whenever possible. Never throws synchronously; a bad/unreachable URL rejects the
// returned promise instead, for the caller to handle (Phase 2 requirement: a failed load must not
// break the active camera or meeting).
export function preloadBackgroundImage(src: string): Promise<HTMLImageElement> {
  if (!src) return Promise.reject(new Error('No background image source provided'));

  const cached = getCachedBackgroundImage(src);

  if (cached) {
    logDebug('cache hit (already decoded)', { src });

    return Promise.resolve(cached);
  }

  const existingRequest = inFlight.get(src);

  if (existingRequest) {
    logDebug('cache miss -- joining an already in-flight decode', { src });

    return existingRequest;
  }

  const startedAt = Date.now();
  const image = new Image();

  image.crossOrigin = 'anonymous';

  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const onError = () => {
      image.removeEventListener('error', onError);
      reject(new Error(`Failed to load background image: ${src}`));
    };

    image.addEventListener('error', onError);

    const finish = () => {
      touch(src, image);
      logDebug('decode complete', { src, ms: Date.now() - startedAt });
      resolve(image);
    };

    image.src = src;

    // decode() is the real readiness signal (the bitmap is actually ready for a cheap drawImage,
    // not just that the bytes arrived) -- fall back to the plain `load` event on engines without
    // it. decode() can reject even for a perfectly good image on some engines (a known Safari
    // quirk), so a rejection there is re-checked against .complete before treating it as a real
    // failure.
    if (typeof image.decode === 'function') {
      image.decode().then(finish, () => {
        if (image.complete && image.naturalWidth > 0) finish();
        else onError();
      });
    } else if (image.complete && image.naturalWidth > 0) {
      finish();
    } else {
      image.addEventListener('load', finish, { once: true });
    }
  }).finally(() => {
    inFlight.delete(src);
  });

  inFlight.set(src, request);
  logDebug('cache miss -- starting decode', { src });

  return request;
}

// Best-effort prefetch for a known list of background URLs (e.g. called when the virtual
// background modal opens, so by the time the user actually taps a preset it's often already
// cached). Never throws, never blocks the caller, and deliberately loads ONE AT A TIME (not
// Promise.all) so opening the modal never fires 7 simultaneous decodes on a slow device --
// "do not load large numbers of background images simultaneously".
export function preloadPresetBackgroundImages(sources: string[]): void {
  let index = 0;

  const loadNext = () => {
    if (index >= sources.length) return;

    const src = sources[index];

    index += 1;

    preloadBackgroundImage(src).catch(() => {
      // A failed PREFETCH is not an error the user needs to see -- a real selection attempt
      // later will retry via the same cache and surface its own failure through
      // JitsiStreamBackgroundEffect.setVirtualBackground's own catch handler.
    }).finally(() => {
      const ric = (globalThis as any).requestIdleCallback as ((cb: () => void) => void) | undefined;

      if (typeof ric === 'function') ric(loadNext);
      else setTimeout(loadNext, 0);
    });
  };

  loadNext();
}

// Test-only escape hatch (and a safety valve for a very long-running tab) -- not called from any
// normal app code path.
export function clearBackgroundImageCache(): void {
  cache.clear();
  inFlight.clear();
}
