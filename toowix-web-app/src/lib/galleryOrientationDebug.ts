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

export function logGalleryDebug(label: string, data: Record<string, unknown>): void {
  if (!isGalleryDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[gallery-orientation-debug] ${label}`, data);
}
