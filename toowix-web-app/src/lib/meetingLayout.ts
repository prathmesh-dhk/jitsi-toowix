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
  const count = Math.max(1, Math.floor(input.participantCount));
  const gap = input.gap ?? 12;
  const ratios = input.ratios ?? ['16:9', '4:3'];
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);

  if (input.forceColumns) {
    // Defensive clamp -- the caller (mobile pagination) is expected to already hand this function
    // at most MOBILE_GALLERY_TILES_PER_PAGE tiles per call, but this keeps a bug in that chunking
    // from ever asking for more rows than a single page is supposed to hold.
    return calculateForcedColumnLayout(
      Math.min(count, MOBILE_GALLERY_TILES_PER_PAGE), input.forceColumns, width, height, gap,
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

  // A forced column count is a hard constraint, not an aesthetic preference -- there is only one
  // valid structure to choose (the hysteresis below exists to resist switching BETWEEN candidate
  // structures when neither is clearly better, which doesn't apply here). Returning it directly
  // also makes an orientation change or a mobile breakpoint crossing recalculate immediately
  // instead of being held back by the area-improvement threshold.
  if (input.forceColumns) return best;

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

// --- Mixed-aspect-ratio gallery packing -----------------------------------------------------
// calculateMeetingLayout/chooseStableLayout above size EVERY cell to the same ratio -- correct
// for a gallery of uniform (desktop/landscape) cameras, but a mobile participant's real portrait
// stream forced into that uniform shape is either cropped or letterboxed (see videoOrientation.ts
// "Option A", which only fixes the letterboxing, not the shape). This section is an ADDITIVE
// extension, not a second competing engine: it reuses the exact same row/column partitioning,
// minimum-tile-size enforcement, and candidate-search structure as calculateMeetingLayout above,
// just searching over ROW count instead of column count, because each row can now size itself to
// its own cards' real ratios instead of every cell sharing one.
//
// Classic "justified row" gallery packing (the technique galleries like Flickr's and justified.js
// use): partition cards into rows, give every card in a row the SAME height, and let that row's
// height be whatever height makes `sum(ratio_i * height) + gaps` exactly fill the stage width. Row
// heights are then uniformly scaled down (never up past 1x, to avoid ever cropping/stretching) so
// the whole stack fits the stage height. Searching over row counts and keeping the one that uses
// the most total area is the same "try structures, keep the best" shape as the search above.
export interface MixedAspectCardInput {
  key: string;
  // width / height. Callers should pass an already-bucketed ratio (see videoOrientation.ts's
  // bucketAspectRatio) so a continuously-drifting raw decode size never reaches this layer.
  ratio: number;
}

export interface MixedAspectCell {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MixedAspectLayoutResult {
  rows: number;
  cells: MixedAspectCell[];
  // Total area actually used by cards (not the stage) -- chooseStableMixedAspectLayout's own
  // improvement-gain comparison, and a plain equality check for memoizing "nothing changed".
  totalArea: number;
}

const DEFAULT_CARD_RATIO = 16 / 9;

function partitionIntoRows<T>(cards: T[], rows: number): T[][] {
  const columns = Math.ceil(cards.length / rows);
  const partitions: T[][] = [];

  for (let row = 0; row * columns < cards.length; row += 1) {
    partitions.push(cards.slice(row * columns, Math.min(cards.length, (row + 1) * columns)));
  }

  return partitions;
}

/**
 * One candidate: cards partitioned into exactly `rowCount` rows. Returns null when any resulting
 * card would fall below the enforced minimum tile size -- exactly like sizeForStructure above,
 * this candidate is then simply not offered rather than ever being rendered too small.
 */
function layoutForRowCount(
  cards: MixedAspectCardInput[], rowCount: number, width: number, height: number, gap: number,
): MixedAspectLayoutResult | null {
  const rowsOfCards = partitionIntoRows(cards, rowCount);

  if (rowsOfCards.length === 0) return null;

  const rowNaturalHeights = rowsOfCards.map((row) => {
    const sumRatio = row.reduce((sum, card) => sum + card.ratio, 0);

    return (width - gap * (row.length - 1)) / sumRatio;
  });

  if (rowNaturalHeights.some((h) => !Number.isFinite(h) || h <= 0)) return null;

  const sumNaturalHeights = rowNaturalHeights.reduce((sum, h) => sum + h, 0);
  // Gaps are fixed pixels, not part of any card's own size -- only the rows' own heights scale
  // down to fit, never the gaps between them. Computing the scale against the TOTAL (rows + gaps)
  // and then leaving the gaps unscaled would under-shrink the rows by exactly the gap total,
  // overflowing the stage by (gaps * (1 - scale)) once there's more than one row.
  const availableForRows = height - gap * (rowsOfCards.length - 1);

  if (availableForRows <= 0) return null;

  // Only ever shrink to fit, never stretch past a row's own natural (width-filling) height --
  // stretching would either distort individual cards or blow the row past the stage width.
  const scale = sumNaturalHeights > 0 ? Math.min(1, availableForRows / sumNaturalHeights) : 1;
  const scaledRowHeights = rowNaturalHeights.map((h) => roundHalfPixel(h * scale));

  for (let i = 0; i < rowsOfCards.length; i += 1) {
    const rowHeight = scaledRowHeights[i];
    const narrowestCardWidth = rowHeight * Math.min(...rowsOfCards[i].map((c) => c.ratio));

    if (rowHeight < MIN_TILE_HEIGHT || narrowestCardWidth < MIN_TILE_WIDTH) return null;
  }

  const totalScaledHeight = scaledRowHeights.reduce((sum, h) => sum + h, 0) + gap * (rowsOfCards.length - 1);
  const top0 = Math.max(0, roundHalfPixel((height - totalScaledHeight) / 2));

  const cells: MixedAspectCell[] = [];
  let totalArea = 0;
  let top = top0;

  rowsOfCards.forEach((row, rowIndex) => {
    const rowHeight = scaledRowHeights[rowIndex];
    const cardWidths = row.map((card) => roundHalfPixel(card.ratio * rowHeight));
    const rowWidth = cardWidths.reduce((sum, w) => sum + w, 0) + gap * (row.length - 1);
    let left = Math.max(0, roundHalfPixel((width - rowWidth) / 2));

    row.forEach((card, columnIndex) => {
      const cardWidth = cardWidths[columnIndex];

      cells.push({ key: card.key, left, top, width: cardWidth, height: rowHeight });
      totalArea += cardWidth * rowHeight;
      left += cardWidth + gap;
    });
    top += rowHeight + gap;
  });

  return { rows: rowsOfCards.length, cells, totalArea };
}

/**
 * Best mixed-ratio layout for this exact stage size, with no memory of any previous layout --
 * same "absolute best fit right now" role calculateMeetingLayout plays for the uniform case.
 */
export function calculateMixedAspectLayout(
  cards: MixedAspectCardInput[], width: number, height: number, gap = 12,
): MixedAspectLayoutResult {
  const safeCards = cards.length > 0 ? cards : [ { key: '__empty__', ratio: DEFAULT_CARD_RATIO } ];
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  let best: MixedAspectLayoutResult | null = null;

  for (let rowCount = 1; rowCount <= safeCards.length; rowCount += 1) {
    const candidate = layoutForRowCount(safeCards, rowCount, safeWidth, safeHeight, gap);

    if (candidate && (!best || candidate.totalArea > best.totalArea + 1)) {
      best = candidate;
    }
  }

  if (best) return best;

  // No row count reaches the minimum tile size (a very small stage) -- fall back to the least-bad
  // single-row-per-card-group layout so cards are still placed rather than this throwing.
  let smallest: MixedAspectLayoutResult | null = null;

  for (let rowCount = 1; rowCount <= safeCards.length; rowCount += 1) {
    const rowsOfCards = partitionIntoRows(safeCards, rowCount);
    // Same gaps-are-fixed-pixels accounting as layoutForRowCount above -- divide only the space
    // left AFTER reserving the (unscaled) gaps between rows, never the raw stage height.
    const rowHeight = Math.max(1, (safeHeight - gap * (rowsOfCards.length - 1)) / rowsOfCards.length);
    const cells: MixedAspectCell[] = [];
    let top = 0;

    rowsOfCards.forEach((row) => {
      let left = 0;
      const sumRatio = row.reduce((sum, c) => sum + c.ratio, 0);
      const naturalRowHeight = sumRatio > 0 ? (safeWidth - gap * (row.length - 1)) / sumRatio : rowHeight;
      const effectiveHeight = Math.min(rowHeight, naturalRowHeight > 0 ? naturalRowHeight : rowHeight);

      row.forEach((card) => {
        const cardWidth = roundHalfPixel(card.ratio * effectiveHeight);

        cells.push({ key: card.key, left, top, width: cardWidth, height: roundHalfPixel(effectiveHeight) });
        left += cardWidth + gap;
      });
      top += rowHeight + gap;
    });

    const totalArea = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    const candidate: MixedAspectLayoutResult = { rows: rowsOfCards.length, cells, totalArea };

    if (!smallest || candidate.totalArea > smallest.totalArea) smallest = candidate;
  }

  return smallest as MixedAspectLayoutResult;
}

const MIXED_ROW_SWITCH_GAIN = 0.08;

/**
 * Stable version of calculateMixedAspectLayout: keeps the current row count unless a candidate
 * beats it by enough total area to be worth the disruption -- same hysteresis role
 * chooseStableLayout plays for the uniform case, just comparing row counts instead of columns.
 */
export function chooseStableMixedAspectLayout(
  cards: MixedAspectCardInput[], width: number, height: number, gap: number, currentRows: number | null,
): MixedAspectLayoutResult {
  const best = calculateMixedAspectLayout(cards, width, height, gap);

  if (!currentRows) return best;

  const held = layoutForRowCount(cards.length > 0 ? cards : [ { key: '__empty__', ratio: DEFAULT_CARD_RATIO } ], currentRows, Math.max(1, width), Math.max(1, height), gap);

  if (!held) return best;
  if (held.rows === best.rows) return held;

  const improvement = (best.totalArea - held.totalArea) / Math.max(held.totalArea, 1);

  return improvement < MIXED_ROW_SWITCH_GAIN ? held : best;
}

/**
 * React hook wrapping chooseStableMixedAspectLayout with the previous row count remembered across
 * renders, committed in a layout effect for the same StrictMode-safety reason as
 * useStableMeetingLayout below. The hold is discarded when the participant count changes (an
 * immediate re-fit on join/leave) but NOT on a ratio-only change for an existing participant --
 * that still goes through the normal improvement-gain comparison, so one phone rotating doesn't
 * necessarily reshuffle everyone else's row.
 */
export function useStableMixedAspectLayout(
  cards: MixedAspectCardInput[], width: number, height: number, gap = 12,
): MixedAspectLayoutResult {
  const committedRef = useRef<{ count: number; rows: number } | null>(null);
  const committed = committedRef.current;
  const heldRows = committed && committed.count === cards.length ? committed.rows : null;
  const next = chooseStableMixedAspectLayout(cards, width, height, gap, heldRows);

  useLayoutEffect(() => {
    committedRef.current = { count: cards.length, rows: next.rows };
  });

  return next;
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
