// TEMPORARY, dev-only diagnostics for tracing mobile portrait video orientation end to end:
// capture -> outgoing track -> receiver <video> metadata -> ratio bucket -> per-participant ratio
// map -> gallery layout selection -> final rendered card size. OFF by default; never reachable in
// a production build (same isProductionBuild() gate as backgroundDebugTools.ts's readFlag, which
// this mirrors). Enable with ?galleryDebug=1 once (persists via localStorage) or
// localStorage.setItem('toowix_gallery_debug', '1'). Remove this module and its call sites once
// the real root cause of inconsistent mobile portrait rendering is confirmed and fixed -- it is
// intentionally NOT meant to ship long-term.
//
// Never logs stream contents, tokens, participant names/avatars, or any other meeting content --
// only numeric geometry (widths/heights/ratios) and short enum-like labels (view mode, device
// category, participant id -- an opaque Jitsi conference id, not a real name).
function isProductionBuild(): boolean {
  try {
    return Boolean((import.meta as any)?.env?.PROD);
  } catch {
    return false;
  }
}

export function isGalleryDebugEnabled(): boolean {
  if (isProductionBuild()) return false;
  try {
    if (typeof location !== 'undefined') {
      const fromUrl = new URLSearchParams(location.search).get('galleryDebug');

      if (fromUrl === '1') {
        localStorage.setItem('toowix_gallery_debug', '1');

        return true;
      }
    }

    return typeof localStorage !== 'undefined' && localStorage.getItem('toowix_gallery_debug') === '1';
  } catch {
    return false;
  }
}

// On-screen snapshot store, for reading these same diagnostics on a phone where the console isn't
// reachable without a USB-tethered remote-debugging session (chrome://inspect / Safari Web
// Inspector). A plain mutable singleton + subscriber list -- deliberately not Context/Redux/etc,
// since this is a temporary tool with exactly one consumer (GalleryOrientationDebugOverlay).
export interface IGalleryDebugSnapshot {
  captureSettings: Record<string, unknown> | null;
  viewMode: Record<string, unknown> | null;
  gallerySelection: Record<string, unknown> | null;
  // Keyed by participant id ('local' or the remote's conference id) -- each card's own latest
  // receiver video metadata, so a specific participant's portrait/landscape mismatch is visible
  // even with several tiles on screen.
  receiverByParticipant: Record<string, Record<string, unknown>>;
}

const snapshot: IGalleryDebugSnapshot = {
  captureSettings: null,
  viewMode: null,
  gallerySelection: null,
  receiverByParticipant: {},
};
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

export function subscribeGalleryDebugSnapshot(fn: () => void): () => void {
  subscribers.add(fn);

  return () => subscribers.delete(fn);
}

export function getGalleryDebugSnapshot(): IGalleryDebugSnapshot {
  return snapshot;
}

function setSnapshot(label: string, data: Record<string, unknown>): void {
  if (label === 'local capture settings') {
    snapshot.captureSettings = data;
  } else if (label === 'active view mode') {
    snapshot.viewMode = data;
  } else if (label === 'gallery layout selection') {
    snapshot.gallerySelection = data;
  } else if (label === 'receiver video metadata' && typeof data.participant === 'string') {
    snapshot.receiverByParticipant = { ...snapshot.receiverByParticipant, [data.participant]: data };
  } else {
    return; // Card-ratio-report and unbind events are console-only -- too chatty for an overlay.
  }
  notify();
}

// Same call every existing diagnostic call site already makes -- now ALSO updates the on-screen
// snapshot (when the overlay has anything to show for that particular label), so there is exactly
// one call to instrument per checkpoint, not two.
export function logGalleryDebug(label: string, data: Record<string, unknown>): void {
  if (!isGalleryDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[gallery-orientation-debug] ${label}`, data);
  setSnapshot(label, data);
}
