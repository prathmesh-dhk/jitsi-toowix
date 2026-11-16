import { useLayoutEffect, useRef } from 'react';

export type MeetingLayoutMode = 'gallery' | 'pinned' | 'screen-share';
export type MeetingCardRatio = '16:9' | '4:3';

export interface MeetingLayoutInput {
  participantCount: number;
  width: number;
  height: number;
  mode: MeetingLayoutMode;
  sidePanelOpen: boolean;
  gap?: number;
  ratios?: MeetingCardRatio[];
  // When set, always lay out exactly this many columns (rows = ceil(participantCount / forceColumns))
  // instead of letting calculateMeetingLayout's own area-maximizing search choose the column count.
  // Used by the mobile tile-view rule: 4+ participants on mobile always get a fixed 2-column grid,
  // because the unconstrained search can legitimately decide one full-width column of large tiles has
  // more total area than two narrower columns on a narrow viewport, and pick 1 column -- that's the
  // single-column "stacking" bug this exists to prevent. The caller decides when to set this (e.g.
  // from the TOTAL participant count, not a single page's count -- see MeetingRoomPage.tsx), so a
  // short last page (e.g. 1 tile left over after paginating) still gets 2-column sizing instead of
  // being treated as a lone "solo" tile.
  forceColumns?: number;
  // Same idea as forceColumns, transposed: always lay out exactly this many rows (columns =
  // ceil(participantCount / forceRows)), paginated the same way. Used on a wide-but-short stage
  // (a tablet in landscape) where forceColumns:2 would produce exactly two narrow columns running
  // the full height of the screen -- the "scrollable sideways" complaint this exists to prevent.
  // Two fixed rows uses the stage's actual wide shape instead of fighting it. Mutually exclusive
  // with forceColumns; the caller picks whichever matches the stage's current orientation.
  forceRows?: number;
}

export interface MeetingLayoutResult {
  columns: number;
  rows: number;
  ratio: MeetingCardRatio;
  cardWidth: number;
  cardHeight: number;
}

// Mobile tile view paginates to at most this many tiles per page (local tile included). Exported
// so the page-chunking logic in MeetingRoomPage.tsx and this file's own defensive clamp agree on
// one number instead of two separately-maintained literal 8s.
export const MOBILE_GALLERY_TILES_PER_PAGE = 8;

const RATIO_VALUES: Record<MeetingCardRatio, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
};

// A card below this size is unusable regardless of how much "better" the fit looks on paper --
// used both to reject candidates outright and to decide whether the CURRENT structure still
// holds up at a new size (see chooseStableLayout).
const MIN_TILE_WIDTH = 120;
const MIN_TILE_HEIGHT = 90;

// Fallback ratio for an empty/placeholder card (no real participant yet) -- shared by every
// engine in this file that needs a safe default when a real ratio is missing or non-finite.
const DEFAULT_CARD_RATIO = 16 / 9;

// A candidate must beat the current (still-valid) structure by this much relative area before
// it's worth the visual disruption of a column-count change. Switching ratio (16:9 <-> 4:3) asks
// for more, since that's an even bigger visual jump. Recommended ranges per the spec: 5-10% for
// column switches, settled on 12% for ratio switches.
const COLUMN_SWITCH_GAIN = 0.08;
const RATIO_SWITCH_GAIN = 0.12;

// Rounds to the nearest half pixel -- prevents the kind of 268.333... / 268.666... alternation
// between adjacent calculated values that reads as shaking even though the layout itself didn't
// change.
function roundHalfPixel(value: number): number {
  return Math.floor(value * 2) / 2;
}

/**
 * Card size for one candidate structure (column count + ratio) at this stage size, with no minimum
 * check. Returns null only when the cells have no room at all.
 */
function rawSizeForStructure(
  count: number, columns: number, ratio: MeetingCardRatio, width: number, height: number, gap: number,
): MeetingLayoutResult | null {
  const ratioValue = RATIO_VALUES[ratio];
  const rows = Math.ceil(count / columns);
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const cellHeight = (height - gap * (rows - 1)) / rows;

  if (cellWidth <= 0 || cellHeight <= 0) return null;

  const cardWidth = Math.min(cellWidth, cellHeight * ratioValue);
  const cardHeight = cardWidth / ratioValue;

  return { columns, rows, ratio, cardWidth: roundHalfPixel(cardWidth), cardHeight: roundHalfPixel(cardHeight) };
}

/**
 * Pure per-candidate sizing: a candidate is usable only when its cards stay at or above the enforced
 * minimum. Returns null otherwise (never offered as a switch target, and a signal that the CURRENT
 * structure -- if this is being used to re-evaluate it -- no longer fits).
 */
function sizeForStructure(
  count: number, columns: number, ratio: MeetingCardRatio, width: number, height: number, gap: number,
): MeetingLayoutResult | null {
  const candidate = rawSizeForStructure(count, columns, ratio, width, height, gap);

  if (!candidate || candidate.cardWidth < MIN_TILE_WIDTH || candidate.cardHeight < MIN_TILE_HEIGHT) return null;

  return candidate;
}

/**
 * Lays out exactly `count` tiles in a grid fixed at `columns` columns (rows = ceil(count / columns)),
 * instead of letting the area-maximizing search in calculateMeetingLayout choose the column count.
 * Forced mobile pages deliberately fill their grid cells rather than preserving a video aspect
 * ratio. The video element itself uses `object-fit: cover`, so any crop happens inside the card
 * instead of leaving unusable letterbox space above and below the grid.
 */
function calculateForcedColumnLayout(
  count: number, columns: number, width: number, height: number, gap: number,
): MeetingLayoutResult {
  const rows = Math.ceil(count / columns);

  return {
    columns,
    rows,
    // The value remains for consumers that display the selected ratio; forced cards have an
    // intentionally fluid geometry and must not apply it as an aspect-ratio CSS constraint.
    ratio: '16:9',
    // Keep the exact division here. Rounding down would leave a visible 1px strip at the
    // bottom of grids such as 2 × 3; browsers render fractional CSS pixels correctly.
    cardWidth: (width - (columns - 1) * gap) / columns,
    cardHeight: (height - (rows - 1) * gap) / rows,
  };
}

/**
 * The forceColumns transpose: fixes `rows`, computes columns = ceil(count / rows). Same fluid
 * geometry policy as calculateForcedColumnLayout (no aspect-ratio enforcement, exact division).
 */
function calculateForcedRowLayout(
  count: number, rows: number, width: number, height: number, gap: number,
): MeetingLayoutResult {
  const columns = Math.ceil(count / rows);

  return {
    columns,
    rows,
    ratio: '16:9',
    cardWidth: (width - (columns - 1) * gap) / columns,
    cardHeight: (height - (rows - 1) * gap) / rows,
  };
}

/**
 * Finds the equal-card layout that gives each person the largest visible area, with no memory of
 * any previous layout -- this is the "absolute best fit for this exact size" answer, which is
 * also exactly what produces flicker if called on its own every resize tick (the best answer
 * shifts by a few percent around every threshold). Used internally by chooseStableLayout as the
 * candidate to compare the current (held) structure against, and directly for a first render
 * where there is no previous structure to hold.
 * The caller renders cards in a centered wrapping flex container, which also
 * centers an incomplete final row without special-case spacer elements.
 */
export function calculateMeetingLayout(input: MeetingLayoutInput): MeetingLayoutResult {
  // Math.max(1, NaN) is NaN, not 1 -- a non-finite participantCount/width/height would otherwise
  // leak NaN straight into the returned card geometry (renders as "NaNpx"), and a non-finite count
  // specifically would make the column-count search below (`columns = 1; columns <= count`) loop
  // forever on Infinity. Number.isFinite rejects both NaN and +/-Infinity, so this falls back to a
  // sane default instead of either. The 500 cap is a sanity ceiling (no real meeting approaches
  // this), not a real-world constraint -- it exists only so a corrupted/malicious count can't make
  // this search pathologically slow.
  const safeCount = Number.isFinite(input.participantCount) ? Math.floor(input.participantCount) : 1;
  const count = Math.min(500, Math.max(1, safeCount));
  const gap = input.gap ?? 12;
  const ratios = input.ratios ?? ['16:9', '4:3'];
  const width = Number.isFinite(input.width) ? Math.max(1, input.width) : 1;
  const height = Number.isFinite(input.height) ? Math.max(1, input.height) : 1;

  if (input.forceColumns) {
    // Defensive clamp -- the caller (mobile pagination) is expected to already hand this function
    // at most MOBILE_GALLERY_TILES_PER_PAGE tiles per call, but this keeps a bug in that chunking
    // from ever asking for more rows than a single page is supposed to hold.
    return calculateForcedColumnLayout(
      Math.min(count, MOBILE_GALLERY_TILES_PER_PAGE), input.forceColumns, width, height, gap,
    );
  }

  if (input.forceRows) {
    return calculateForcedRowLayout(
      Math.min(count, MOBILE_GALLERY_TILES_PER_PAGE), input.forceRows, width, height, gap,
    );
  }

  let best: MeetingLayoutResult | null = null;

  for (const ratio of ratios) {
    for (let columns = 1; columns <= count; columns += 1) {
      const candidate = sizeForStructure(count, columns, ratio, width, height, gap);

      if (!candidate) continue;
      // Prefer larger cards. A small tolerance avoids ratio/column flicker when a
      // ResizeObserver reports sub-pixel changes while a panel animates.
      if (!best || candidate.cardWidth * candidate.cardHeight > best.cardWidth * best.cardHeight + 1) {
        best = candidate;
      }
    }
  }

  if (best) return best;

  // No structure reaches the minimum tile size (a very small stage). Still choose the largest structure
  // that fits, so cards are never sized into an overflow that the gallery would clip.
  let smallest: MeetingLayoutResult | null = null;

  for (const ratio of ratios) {
    for (let columns = 1; columns <= count; columns += 1) {
      const candidate = rawSizeForStructure(count, columns, ratio, width, height, gap);

      if (candidate && (!smallest || candidate.cardWidth * candidate.cardHeight > smallest.cardWidth * smallest.cardHeight)) {
        smallest = candidate;
      }
    }
  }

  return smallest || {
    columns: 1,
    rows: count,
    ratio: '16:9',
    cardWidth: roundHalfPixel(width),
    cardHeight: roundHalfPixel(width / (16 / 9)),
  };
}

/**
 * The stable version: keeps the CURRENT structure (columns + ratio) unless a candidate is enough
 * better to justify the disruption of switching. This is what a resize handler should call every
 * tick, not calculateMeetingLayout directly -- card width/height still update continuously every
 * call (so dragging still feels responsive), only the column count and ratio are protected by
 * hysteresis.
 */
export function chooseStableLayout(
  input: MeetingLayoutInput, current: MeetingLayoutResult | null,
): MeetingLayoutResult {
  const count = Math.max(1, Math.floor(input.participantCount));
  const gap = input.gap ?? 12;
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const best = calculateMeetingLayout(input);

  // A forced column (or row) count is a hard constraint, not an aesthetic preference -- there is
  // only one valid structure to choose (the hysteresis below exists to resist switching BETWEEN
  // candidate structures when neither is clearly better, which doesn't apply here). Returning it
  // directly also makes an orientation change or a mobile breakpoint crossing recalculate
  // immediately instead of being held back by the area-improvement threshold.
  if (input.forceColumns || input.forceRows) return best;

  if (!current) return best;

  const held = sizeForStructure(count, current.columns, current.ratio, width, height, gap);

  // The current structure no longer produces a usable card size at this size (e.g. the window
  // shrank a lot) -- nothing to hold onto, fall through to the best candidate.
  if (!held) return best;

  const ratioChanged = best.ratio !== held.ratio;
  const columnsChanged = best.columns !== held.columns;

  if (!ratioChanged && !columnsChanged) return held;

  const heldArea = held.cardWidth * held.cardHeight;
  const bestArea = best.cardWidth * best.cardHeight;
  const improvement = (bestArea - heldArea) / Math.max(heldArea, 1);
  const requiredGain = ratioChanged ? RATIO_SWITCH_GAIN : COLUMN_SWITCH_GAIN;

  return improvement < requiredGain ? held : best;
}

export interface MeetingCellPosition {
  left: number;
  top: number;
}

/**
 * Places `count` equal cards on the rows/columns of `layout`, inside a stage of `width` x `height`.
 * Cards are positioned explicitly (not by CSS wrapping), so the structure chosen here is exactly the
 * structure rendered. Each row is centred on its own, so an incomplete final row stays centred.
 */
export function calculateCellPositions(
  count: number, layout: MeetingLayoutResult, width: number, height: number, gap = 12,
): MeetingCellPosition[] {
  const totalHeight = layout.rows * layout.cardHeight + (layout.rows - 1) * gap;
  const top = Math.max(0, roundHalfPixel((height - totalHeight) / 2));
  const positions: MeetingCellPosition[] = [];

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / layout.columns);
    const column = index - row * layout.columns;
    const rowCount = Math.min(layout.columns, count - row * layout.columns);
    const rowWidth = rowCount * layout.cardWidth + (rowCount - 1) * gap;
    const left = Math.max(0, roundHalfPixel((width - rowWidth) / 2)) + column * (layout.cardWidth + gap);

    positions.push({
      left: roundHalfPixel(left),
      top: roundHalfPixel(top + row * (layout.cardHeight + gap)),
    });
  }

  return positions;
}

/**
 * React hook wrapping chooseStableLayout with the previous structure remembered across renders.
 * The remembered structure is committed in a layout effect, not written during render, so a render
 * that React discards (Strict Mode double render, concurrent retry) cannot change the next decision.
 * The hold is also discarded when the participant count changes, so joins and leaves re-fit at once.
 *
 * Card geometry is recalculated every call; only columns/rows/ratio are held stable. Call once
 * per render with the latest measured width/height.
 */
export function useStableMeetingLayout(input: MeetingLayoutInput): MeetingLayoutResult {
  const committedRef = useRef<{ count: number; layout: MeetingLayoutResult } | null>(null);
  const count = Math.max(1, Math.floor(input.participantCount));
  const committed = committedRef.current;
  const held = committed && committed.count === count ? committed.layout : null;
  const next = chooseStableLayout(input, held);

  useLayoutEffect(() => {
    committedRef.current = { count, layout: next };
  });

  return next;
}

// --- Flexible full-fill gallery packing (TOOWIX_PHASE_1_2_FLEXIBLE_FULL_FILL_GALLERY_IMPLEMENTATION.md) ---
// The uniform engine above treats a card's real/preferred ratio as something to PRESERVE exactly,
// which necessarily leaves unfilled stage area whenever the participant mix doesn't tile perfectly
// at that ratio (the "big empty bands" regression this section fixes). This engine inverts the
// priority: ratio is only a PREFERENCE that nudges relative tile proportions, while 100% of the
// usable stage (minus fixed gaps) is always tiled by construction.
//
// Algorithm -- weighted row/column tessellation: partition the N cards into R rows (same stable,
// original-order partitioning as partitionFlexRows below), then:
//   1. Each row's height is proportional to that row's total "tallness weight" (sum of 1/ratio over
//      its cards), normalized so the rows' heights sum to EXACTLY the available height (not however
//      much each row "wants"). A row containing portrait-preferring cards ends up taller; an all-
//      landscape row ends up shorter -- but the stack always fills the stage vertically.
//   2. Within each row, each card's width is proportional to that card's own ratio, normalized so
//      the row's widths sum to EXACTLY the available width. A landscape-preferring card ends up
//      wider than a portrait-preferring card in the same row -- but the row always fills the stage
//      horizontally.
// Because both normalizations force an exact sum, every valid candidate (any R) already achieves
// ~100% coverage by construction (modulo the already-reserved fixed pixel gaps) -- there is no
// "coverage" axis to search over. What actually differs between candidates is tile SHAPE: more rows
// means more, squarer, smaller tiles; fewer rows means fewer, more extreme tiles. Candidate search
// therefore scores shape quality (how small/extreme the worst tile is, how far the average tile
// drifts from its own preferred ratio) rather than coverage.
export interface FlexibleTileInput {
  key: string;
  // Real (bucketed) decoded video ratio, width / height -- a PREFERENCE, never enforced exactly.
  preferredRatio: number;
}

export interface FlexibleTileFrame {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlexibleFillLayout {
  frames: FlexibleTileFrame[];
  // Stable structural signature (row count + per-row card count) for hysteresis/FLIP animation --
  // identical in shape to the other engines' own structure keys in this file.
  topologyKey: string;
  // Total card rectangle area / usable stage area (excluding only the fixed gaps between cards),
  // calculated from the actual placed frames -- not assumed to be exactly 1 because of rounding.
  coverageFraction: number;
  // Per-key fraction of the source video's own image that a centered object-fit: cover crop cuts
  // off (see calculateCroppedFraction) -- 0 means no crop, exposed so callers (dev diagnostics,
  // tests) can measure actual crop severity rather than inferring it from card shape alone.
  cropFractionByKey: Record<string, number>;
  worstCropFraction: number;
  meanCropFraction: number;
}

export interface FlexibleFillOptions {
  mode: 'mobile' | 'desktop';
  gap: number;
}

// Below this size in either dimension a tile is no longer usably readable (name badge, mute icon,
// tap target) -- used only to SCORE candidates (steer the search away from tiny slivers), never to
// reject a layout outright: unlike the other engines, this one must always return a full-coverage
// result even on a very small/crowded stage (see TOOWIX_PHASE_1_2_FLEXIBLE_FULL_FILL_GALLERY_IMPLEMENTATION.md
// section 1, "prioritize no overflow ... over impractically tiny 100%-packed cards").
const FLEX_MIN_READABLE_DIM: Record<'mobile' | 'desktop', number> = { mobile: 64, desktop: 72 };
// A resulting tile shape beyond this wide/tall is penalized heavily regardless of how well it
// matches its own preferred ratio -- an unreadable sliver is unreadable even if "on-preference".
const FLEX_EXTREME_RATIO = 4;
// Preferred maximum columns in a single row, per mode -- a soft bias (small per-excess-column
// penalty), not a hard limit: mobile favors 1-3 columns, desktop tolerates many more before this
// kicks in, matching section 3's "preferences, not immutable column rules".
const FLEX_PREFERRED_MAX_COLUMNS: Record<'mobile' | 'desktop', number> = { mobile: 3, desktop: 6 };
// Same 8-12%-style stability margin as the other engines' hysteresis (COLUMN_SWITCH_GAIN,
// MIXED_ROW_SWITCH_GAIN) -- a competing row count must be meaningfully better, not just
// infinitesimally better, before the gallery disrupts the current topology.
const FLEX_TOPOLOGY_SWITCH_GAIN = 0.1;

function safeFlexRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_CARD_RATIO;
}

// --- Source-aware crop measurement (TOOWIX_PHASE_3_1_VIDEO_INTEGRITY_SMART_CROPPING.md section 2B) ---
// `object-fit: cover` preserves pixel PROPORTIONS (never distorts) but is not itself a cropping
// budget -- a 9:16 source rendered in a 16:9 card is undistorted yet loses 68% of the original
// image. These two pure functions are the exact formula the plan specifies, used both by the
// solver's own scoring below and exported for direct unit testing.
/**
 * Fraction of the source image's shorter-relative-to-target dimension that remains visible under
 * a centered `object-fit: cover` crop, given the source's own ratio and the rendered card's ratio.
 * 1.0 means no crop (ratios match); approaches 0 as the ratios diverge. Safe for invalid input
 * (returns 0, treated as "fully cropped / not measurable" by callers).
 */
export function visibleSourceFraction(sourceRatio: number, cardRatio: number): number {
  if (!(sourceRatio > 0) || !(cardRatio > 0) || !Number.isFinite(sourceRatio) || !Number.isFinite(cardRatio)) return 0;

  return Math.min(sourceRatio / cardRatio, cardRatio / sourceRatio);
}

/** 1 - visibleSourceFraction -- the fraction of the original source image a cover-cropped card cuts off. */
export function calculateCroppedFraction(sourceRatio: number, cardRatio: number): number {
  return 1 - visibleSourceFraction(sourceRatio, cardRatio);
}

// Crop budget thresholds (plan section 2B, "initial proposed thresholds -- tune with actual
// screenshots"): at/below TARGET, no penalty; between TARGET and WARN, a mild penalty that scales
// with how far past target; beyond WARN, a steep penalty, since this is "unacceptable as normal
// slight crop" territory (the plan's own 9:16-into-16:9 example, ~68% crop).
const FLEX_CROP_TARGET = 0.15;
const FLEX_CROP_WARN = 0.25;

function cropPenaltyFor(croppedFraction: number): number {
  if (croppedFraction <= FLEX_CROP_TARGET) return 0;
  if (croppedFraction <= FLEX_CROP_WARN) return (croppedFraction - FLEX_CROP_TARGET) * 20;

  return (FLEX_CROP_WARN - FLEX_CROP_TARGET) * 20 + (croppedFraction - FLEX_CROP_WARN) * 400;
}

// Stable, original-order partitioning: columns = ceil(count / rows), every row that size except a
// shorter final row.
function partitionFlexRows<T>(cards: T[], rows: number): T[][] {
  const columns = Math.ceil(cards.length / rows);
  const partitions: T[][] = [];

  for (let row = 0; row * columns < cards.length; row += 1) {
    partitions.push(cards.slice(row * columns, Math.min(cards.length, (row + 1) * columns)));
  }

  return partitions;
}

interface FlexCandidate {
  frames: FlexibleTileFrame[];
  rowSizes: number[];
  cost: number;
  coverageFraction: number;
  cropFractionByKey: Record<string, number>;
  worstCropFraction: number;
  meanCropFraction: number;
}

/**
 * One candidate: cards partitioned into exactly `rowCount` rows, each row's height and each card's
 * width solved by the two independent weighted-normalization passes described above. Always
 * returns a usable result (never null/rejected) -- degenerate inputs (zero/negative stage, zero
 * total weight) fall back to equal shares rather than failing, since this engine's whole contract
 * is "always fully tile the stage", unlike the reject-if-too-small engines elsewhere in this file.
 */
function flexCandidateForRowCount(
  tiles: FlexibleTileInput[], rowCount: number, width: number, height: number, gap: number, mode: 'mobile' | 'desktop',
): FlexCandidate {
  const rowGroups = partitionFlexRows(tiles, rowCount);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const availableHeight = Math.max(0, safeHeight - gap * Math.max(0, rowGroups.length - 1));
  const rowTallnessWeights = rowGroups.map((group) => (
    group.reduce((sum, card) => sum + 1 / safeFlexRatio(card.preferredRatio), 0)
  ));
  const totalTallnessWeight = rowTallnessWeights.reduce((sum, w) => sum + w, 0);
  const rowHeights = rowTallnessWeights.map((w) => (
    totalTallnessWeight > 0
      ? roundHalfPixel((availableHeight * w) / totalTallnessWeight)
      : roundHalfPixel(availableHeight / rowGroups.length)
  ));

  const frames: FlexibleTileFrame[] = [];
  const minReadable = FLEX_MIN_READABLE_DIM[mode];
  let worstDim = Infinity;
  let extremeCount = 0;
  let totalCropPenalty = 0;
  let worstCropFraction = 0;
  let cropFractionSum = 0;
  const cropFractionByKey: Record<string, number> = {};
  let columnExcessSum = 0;
  let top = 0;
  let totalCardArea = 0;

  rowGroups.forEach((group, rowIndex) => {
    // A half-pixel floor (not 0) on both dimensions -- even a maximally degenerate stage (zero or
    // negative width/height clamped above, or more rows/columns than the stage has room for) must
    // still produce a POSITIVE frame for every input tile; a literal 0 would violate "width > 0,
    // height > 0" and make object-fit/getBoundingClientRect math downstream divide by zero.
    const rowHeight = Math.max(0.5, rowHeights[rowIndex]);
    const availableWidth = Math.max(0, safeWidth - gap * Math.max(0, group.length - 1));
    const widthWeights = group.map((card) => safeFlexRatio(card.preferredRatio));
    const totalWidthWeight = widthWeights.reduce((sum, w) => sum + w, 0);
    let left = 0;

    columnExcessSum += Math.max(0, group.length - FLEX_PREFERRED_MAX_COLUMNS[mode]);

    group.forEach((card, columnIndex) => {
      const rawWidth = totalWidthWeight > 0
        ? (availableWidth * widthWeights[columnIndex]) / totalWidthWeight
        : availableWidth / group.length;
      const cardWidth = Math.max(0.5, roundHalfPixel(rawWidth));

      frames.push({ key: card.key, left: roundHalfPixel(left), top: roundHalfPixel(top), width: cardWidth, height: rowHeight });
      totalCardArea += cardWidth * rowHeight;
      worstDim = Math.min(worstDim, cardWidth, rowHeight);
      if (cardWidth > 0 && rowHeight > 0) {
        const resultRatio = cardWidth / rowHeight;

        if (resultRatio > FLEX_EXTREME_RATIO || resultRatio < 1 / FLEX_EXTREME_RATIO) extremeCount += 1;

        const cropFraction = calculateCroppedFraction(safeFlexRatio(card.preferredRatio), resultRatio);

        cropFractionByKey[card.key] = cropFraction;
        totalCropPenalty += cropPenaltyFor(cropFraction);
        worstCropFraction = Math.max(worstCropFraction, cropFraction);
        cropFractionSum += cropFraction;
      } else {
        extremeCount += 1;
        cropFractionByKey[card.key] = 1;
        worstCropFraction = Math.max(worstCropFraction, 1);
        cropFractionSum += 1;
      }
      left += cardWidth + gap;
    });
    top += rowHeight + gap;
  });

  const tinyPenalty = Number.isFinite(worstDim) && worstDim < minReadable
    ? (minReadable - Math.max(0, worstDim)) / minReadable
    : 0;
  const cardCount = Math.max(1, tiles.length);
  // Ordering per the spec's scoring priorities (section 2B): tiny/extreme tiles are penalized the
  // most heavily; then the WORST single card's crop (so one severely-cropped portrait participant
  // is never sacrificed to save a couple of percent of stage area elsewhere); then total/average
  // crop across all cards; then the soft column-count preference.
  const cost = tinyPenalty * 1000 + (extremeCount / cardCount) * 500
    + cropPenaltyFor(worstCropFraction) * 3 + (totalCropPenalty / cardCount) + columnExcessSum * 0.5;
  const usableStageArea = Math.max(1, safeWidth * safeHeight);

  return {
    frames, rowSizes: rowGroups.map((g) => g.length), cost, coverageFraction: totalCardArea / usableStageArea,
    cropFractionByKey, worstCropFraction, meanCropFraction: cropFractionSum / cardCount,
  };
}

function toFlexibleFillLayout(candidate: FlexCandidate): FlexibleFillLayout {
  return {
    frames: candidate.frames,
    topologyKey: `flex:${candidate.rowSizes.join(',')}`,
    coverageFraction: candidate.coverageFraction,
    cropFractionByKey: candidate.cropFractionByKey,
    worstCropFraction: candidate.worstCropFraction,
    meanCropFraction: candidate.meanCropFraction,
  };
}

/**
 * Searches every row count from 1 to N (same brute-force-but-cheap shape as every other search in
 * this file) and returns both the lowest-cost candidate and the row count that produced it, so
 * callers that need to hold/re-derive a specific row count (the hysteresis wrapper below) never
 * have to parse it back out of a topologyKey string.
 */
// A stable sort by preferredRatio (ties broken by original index, never randomized) -- grouping
// same-shaped cards into the same row/column can sharply reduce crop for an alternating mix (e.g.
// landscape, portrait, landscape, portrait) on a narrow stage, where pairing each landscape card
// with a portrait partner in the SAME row forces both away from their natural shape. Deterministic
// (same input always sorts the same way) and does not reorder on irrelevant/noisy changes.
function sortTilesByRatio(tiles: FlexibleTileInput[]): FlexibleTileInput[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => safeFlexRatio(a.tile.preferredRatio) - safeFlexRatio(b.tile.preferredRatio) || a.index - b.index)
    .map(({ tile }) => tile);
}

// A flat cost added to the grouped-by-ratio candidate so original join/display order is kept
// UNLESS reordering clearly, meaningfully reduces crop -- "unnecessary participant shuffle" is
// explicitly one of the plan's own scoring penalties (section 2B); this keeps that bias without
// ever forbidding a genuinely better arrangement for a mixed-orientation stage.
const FLEX_REORDER_PENALTY = 3;

/**
 * The best candidate for ONE row count, trying both the original participant order and a
 * grouped-by-ratio order, and keeping whichever scores lower (grouped order pays
 * FLEX_REORDER_PENALTY so it only wins when the crop/shape improvement clearly outweighs the
 * display-order disruption). Used by both the fresh search below and the hysteresis "held"
 * recomputation, so a topology held across renders is evaluated the same way it was chosen.
 */
function bestCandidateForRowCount(
  safeTiles: FlexibleTileInput[], rowCount: number, width: number, height: number, gap: number, mode: 'mobile' | 'desktop',
): FlexCandidate {
  const original = flexCandidateForRowCount(safeTiles, rowCount, width, height, gap, mode);

  if (rowCount <= 1) return original; // a single row has no alternative grouping to try

  const sortedTiles = sortTilesByRatio(safeTiles);
  const alreadySorted = sortedTiles.every((tile, index) => tile.key === safeTiles[index].key);

  if (alreadySorted) return original;

  const grouped = flexCandidateForRowCount(sortedTiles, rowCount, width, height, gap, mode);
  const groupedAdjustedCost = grouped.cost + FLEX_REORDER_PENALTY;

  return groupedAdjustedCost < original.cost - 1e-9 ? { ...grouped, cost: groupedAdjustedCost } : original;
}

function searchFlexibleFillCandidates(
  safeTiles: FlexibleTileInput[], width: number, height: number, gap: number, mode: 'mobile' | 'desktop',
): { rowCount: number; candidate: FlexCandidate } {
  let best: { rowCount: number; candidate: FlexCandidate } | null = null;

  // Side by side is the universal expectation for a 2-person call (every mainstream video app
  // does this) -- the area-maximizing search below can otherwise legitimately pick 2 stacked rows
  // instead whenever the stage happens to land close to square. Reported directly ("after screen
  // share, the 2-participant grid goes above/below, not left/right") and traced to exactly this:
  // reproduces with a fresh 2-person stage at the same squarish aspect, no screen-share involved
  // at all -- the share/stop sequence just happened to leave the stage at that shape, it wasn't
  // stale state. Capping the search to a single row for exactly 2 tiles removes the choice
  // entirely instead of trying to out-tune the cost function for every possible stage shape.
  const maxRowCount = safeTiles.length === 2 ? 1 : safeTiles.length;

  for (let rowCount = 1; rowCount <= maxRowCount; rowCount += 1) {
    const candidate = bestCandidateForRowCount(safeTiles, rowCount, width, height, gap, mode);

    if (!best || candidate.cost < best.candidate.cost - 1e-9) best = { rowCount, candidate };
  }

  // safeTiles.length >= 1 always, so the loop above always runs at least once and `best` is
  // always assigned -- this satisfies the type checker without masking a real bug.
  return best as { rowCount: number; candidate: FlexCandidate };
}

/**
 * Best flexible full-fill layout for this exact stage size, with no memory of any previous layout.
 */
export function calculateFlexibleFillLayout(
  tiles: FlexibleTileInput[], width: number, height: number, options: FlexibleFillOptions,
): FlexibleFillLayout {
  const safeTiles = tiles.length > 0 ? tiles : [ { key: '__empty__', preferredRatio: DEFAULT_CARD_RATIO } ];
  const gap = Math.max(0, options.gap);

  return toFlexibleFillLayout(searchFlexibleFillCandidates(safeTiles, width, height, gap, options.mode).candidate);
}

/**
 * Stable version: keeps the CURRENT row topology unless a competing one is cheap enough to be
 * worth the disruption -- same hysteresis role chooseStableLayout plays for the uniform engine,
 * just comparing this engine's own cost function instead of area.
 * This engine never rejects a row count outright (every candidate is "valid"), so the held
 * candidate is always comparable -- there is no "held no longer fits" fallback branch to handle.
 */
export function chooseStableFlexibleFillLayout(
  tiles: FlexibleTileInput[], width: number, height: number, options: FlexibleFillOptions, currentRowCount: number | null,
): FlexibleFillLayout {
  const safeTiles = tiles.length > 0 ? tiles : [ { key: '__empty__', preferredRatio: DEFAULT_CARD_RATIO } ];
  const gap = Math.max(0, options.gap);
  const { rowCount: bestRowCount, candidate: best } = searchFlexibleFillCandidates(safeTiles, width, height, gap, options.mode);

  if (!currentRowCount || currentRowCount === bestRowCount) return toFlexibleFillLayout(best);

  const held = bestCandidateForRowCount(safeTiles, currentRowCount, width, height, gap, options.mode);
  const relativeGain = held.cost > 0 ? (held.cost - best.cost) / held.cost : (best.cost < held.cost ? 1 : 0);

  return relativeGain < FLEX_TOPOLOGY_SWITCH_GAIN ? toFlexibleFillLayout(held) : toFlexibleFillLayout(best);
}

/**
 * React hook wrapping chooseStableFlexibleFillLayout with the previous row count remembered across
 * renders, committed in a layout effect for the same StrictMode-safety reason as the other stable-
 * layout hooks in this file. The hold is discarded when the participant count changes (join/leave
 * always re-fits at once) but not on a pure ratio change for an existing participant.
 */
export function useStableFlexibleFillLayout(
  tiles: FlexibleTileInput[], width: number, height: number, options: FlexibleFillOptions,
): FlexibleFillLayout {
  const committedRef = useRef<{ count: number; rowCount: number } | null>(null);
  const committed = committedRef.current;
  const heldRowCount = committed && committed.count === tiles.length ? committed.rowCount : null;
  const next = chooseStableFlexibleFillLayout(tiles, width, height, options, heldRowCount);

  useLayoutEffect(() => {
    committedRef.current = { count: tiles.length, rowCount: next.topologyKey.split(':')[1]?.split(',').length ?? 1 };
  });

  return next;
}
