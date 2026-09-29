// Phase 2b: dev-only measurement tools for the virtual background effect. Everything here is OFF
// by default (localStorage flags, unset = off) and none of it is reachable from the normal
// (flags-off) call path in JitsiStreamBackgroundEffect.ts -- kept in its own module so this pure,
// easily-unit-testable logic (flag reading, stats math) doesn't need the DOM/Worker mocking that
// file's own tests require.
export function isMaskDebugEnabled(): boolean {
  return readFlag('toowix_bg_debug_mask');
}

export function isOverlayDebugEnabled(): boolean {
  return readFlag('toowix_bg_debug_overlay');
}

function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
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
