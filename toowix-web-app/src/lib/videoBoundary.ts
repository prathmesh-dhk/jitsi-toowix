// TOOWIX_SMART_VIDEO_SIDE_BOUNDARIES_IMPLEMENTATION_PLAN.md -- smart inner video boundaries for
// excessively wide Gallery View cards. The OUTER card keeps its exact full-fill geometry (chosen
// by meetingLayout.ts's uniform/flexible engines, untouched by this file); only the LIVE VIDEO
// inside it gets a narrower, centered inner viewport when the card is much wider than the source
// video actually needs -- e.g. a portrait phone camera landing in a wide uniform-grid or
// flexible-fill cell. Side areas simply show the card's own existing background color (no new
// element needed -- the outer card div already paints that color; see MeetingParticipantCard.tsx).
//
// Priority order (plan section 0): (1) never stretch/squash a person, (2) never crop top/bottom in
// bounded mode, (3) a stable, centered video, (4) boundaries as close to the outer edges as (1)-(3)
// allow, (5) outer gallery coverage (already handled entirely outside this file). This module only
// ever makes the LIVE VIDEO narrower within its card -- it never touches outer card size, gallery
// geometry, or pagination.

export type BoundaryMode = 'normal' | 'height-protected';

export interface BoundaryResult {
  mode: BoundaryMode;
  // Always finite, >= 0, <= cardWidth. In 'normal' mode this simply equals cardWidth (the video
  // fills the card normally via the caller's own existing cover/contain logic -- unrelated to this
  // module).
  innerWidth: number;
  leftInset: number;
  rightInset: number;
}

// Enter bounded mode once the card is CLEARLY wider than the source needs (not just marginally);
// leave it once the card is CLEARLY no longer that wide. The gap between the two (1.20-1.30) is a
// deliberate dead zone -- hysteresis -- so a card sitting near the boundary (or a ResizeObserver
// delivering a few sub-pixel ticks) never flickers between modes every render. Tunables per the
// plan's own "subject to real-browser calibration" note.
const ENTER_HEIGHT_PROTECTED_RATIO = 1.3;
const EXIT_HEIGHT_PROTECTED_RATIO = 1.2;

/**
 * Pure, synchronous, O(1) -- no DOM, no React, safe to call every render. `previousMode` is the
 * mode this same card was in last time (hysteresis state the caller owns, e.g. in a ref); pass
 * 'normal' for a card's first-ever computation (no held state yet, same convention every other
 * stable-layout hook in this codebase uses).
 *
 * Invalid/missing input (zero or negative card dimensions, a non-finite or non-positive source
 * ratio -- e.g. camera off, metadata not loaded yet) safely falls back to 'normal' mode at the
 * card's own full width, never guessing a ratio from zero/undefined video dimensions.
 */
export function computeSmartVideoBoundary(
  cardWidth: number,
  cardHeight: number,
  sourceRatio: number,
  previousMode: BoundaryMode,
): BoundaryResult {
  const safeCardWidth = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : 0;
  const safeCardHeight = Number.isFinite(cardHeight) && cardHeight > 0 ? cardHeight : 0;
  const safeSourceRatio = Number.isFinite(sourceRatio) && sourceRatio > 0 ? sourceRatio : null;

  if (safeCardWidth <= 0 || safeCardHeight <= 0 || safeSourceRatio === null) {
    return { mode: 'normal', innerWidth: safeCardWidth, leftInset: 0, rightInset: 0 };
  }

  const cardRatio = safeCardWidth / safeCardHeight;
  const ratioOfRatios = cardRatio / safeSourceRatio;

  // Hysteresis: once bounded, stay bounded until clearly below the EXIT threshold; once normal,
  // switch to bounded only once clearly above the ENTER threshold. A value sitting in the dead
  // zone between the two thresholds never changes the current mode either way.
  const mode: BoundaryMode = previousMode === 'height-protected'
    ? (ratioOfRatios <= EXIT_HEIGHT_PROTECTED_RATIO ? 'normal' : 'height-protected')
    : (ratioOfRatios >= ENTER_HEIGHT_PROTECTED_RATIO ? 'height-protected' : 'normal');

  if (mode === 'normal') {
    return { mode: 'normal', innerWidth: safeCardWidth, leftInset: 0, rightInset: 0 };
  }

  // The full-height video width that exactly matches the source's own ratio -- by construction
  // this is always < cardWidth here (entering bounded mode requires cardRatio/sourceRatio >= 1.3,
  // i.e. cardHeight * sourceRatio < cardWidth / 1.3 < cardWidth), so the Math.min is a defensive
  // clamp, not something that normally triggers. A video sized to exactly this width/height has
  // the SAME ratio as the source, so object-fit: contain shows the whole frame with no letterbox
  // bars and no crop -- not an approximation.
  const videoContentWidth = safeCardHeight * safeSourceRatio;
  const innerWidth = Math.min(safeCardWidth, videoContentWidth);
  const sideInset = Math.max(0, (safeCardWidth - innerWidth) / 2);

  return { mode: 'height-protected', innerWidth, leftInset: sideInset, rightInset: sideInset };
}
