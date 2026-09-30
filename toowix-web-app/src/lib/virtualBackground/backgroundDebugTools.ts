// Phase 2b: dev-only measurement tools for the virtual background effect. Everything here is OFF
// by default (localStorage flags, unset = off) and none of it is reachable from the normal
// (flags-off) call path in JitsiStreamBackgroundEffect.ts -- kept in its own module so this pure,
// easily-unit-testable logic (flag reading, stats math) doesn't need the DOM/Worker mocking that
// file's own tests require.
export function isMaskDebugEnabled(): boolean {
  return readFlag('toowix_bg_debug_mask', 'bgDebugMask');
}

export function isOverlayDebugEnabled(): boolean {
  return readFlag('toowix_bg_debug_overlay', 'bgDebug');
}

// Same URL-param-first pattern as readSegmentationEngineOverride() in mediaPipeSegmentation.ts --
// see that function's comment for why a URL param is preferred over asking someone to type a
// console command by hand. ?bgDebug=1 draws a live on-canvas readout (engine, resolution, per-
// stage timing) directly on the video, so which engine is actually running is visible on screen,
// not just inferable from console output.
// GO 3 hardening: excludes every debug tool (mask overlay, text overlay, and by extension
// window.__bgBench/__benchToggle, which are only registered while an effect with these flags
// possible is running -- see JitsiStreamBackgroundEffect.ts) from production builds outright,
// the same import.meta.env.PROD gate readGovTimescale() in JitsiStreamBackgroundEffect.ts uses.
// Checked FIRST and unconditionally, so a URL param or a localStorage value set by mistake (or by
// someone probing a production tab) can never enable these in a real deployment.
function isProductionBuild(): boolean {
  try {
    return Boolean((import.meta as any)?.env?.PROD);
  } catch {
    return false;
  }
}

function readFlag(storageKey: string, urlParam: string): boolean {
  if (isProductionBuild()) return false;
  try {
    if (typeof location !== 'undefined') {
      const fromUrl = new URLSearchParams(location.search).get(urlParam);

      if (fromUrl === '1') {
        localStorage.setItem(storageKey, '1');

        return true;
      }
    }

    return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1';
  } catch {
    // localStorage can be unavailable (private mode, a restricted embed) -- default is off.
    return false;
  }
}

export interface IMetricStats {
  average: number;
  max: number;
  min: number;
  p95: number;
}

// Nearest-rank percentile -- fine for the frame-count sizes a several-second benchmark produces
// (tens to low hundreds of samples at ~30fps), not meant for statistical rigor beyond that.
export function computeStats(samples: number[]): IMetricStats {
  if (samples.length === 0) {
    return { average: 0, max: 0, min: 0, p95: 0 };
  }
  const sorted = [ ...samples ].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return {
    average: sum / sorted.length,
    max: sorted[sorted.length - 1],
    min: sorted[0],
    p95: sorted[p95Index]
  };
}

export function roundTo1Decimal(value: number): number {
  return Math.round(value * 10) / 10;
}
