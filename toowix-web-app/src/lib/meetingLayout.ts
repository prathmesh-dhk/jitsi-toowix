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

// A card is "portrait" when its (already-bucketed, see bucketAspectRatio in videoOrientation.ts)
// ratio is below 1 -- height exceeds width.
function isPortraitRatio(ratio: number): boolean {
  return ratio < 1;
}

/**
 * Dedicated split for exactly two cards where exactly ONE is portrait -- the spec's own
 * (explicitly "preview sizing rule, not yet proven production") formula: the portrait card fills
 * the full stage height at its own real ratio, capped at 63% of the stage width so it can never
 * dominate the row; the other card gets whatever width is left over. This deliberately bypasses
 * the general row-packer below (which would instead derive a SHARED row height from the sum of
 * both ratios, giving a less predictable, less "existing left/right gallery" split than this
 * explicit two-card rule asks for).
 *
 * Returns null -- so the caller falls through to the general packer -- for every case this rule
 * does NOT apply to: not exactly 2 cards, both cards the same "portrait-ness" (both landscape,
 * which is the existing/original two-participant side-by-side case already handled correctly by
 * the general packer for two equal ratios; or both portrait, a symmetric case the general packer
 * also already handles reasonably), or a stage too narrow for the remaining card to stay usable.
 */
export function calculateTwoParticipantMixedLayout(
    cards: MixedAspectCardInput[], width: number, height: number, gap: number,
): MixedAspectLayoutResult | null {
  if (cards.length !== 2) return null;

  const [ first, second ] = cards;
  const firstPortrait = isPortraitRatio(first.ratio);
  const secondPortrait = isPortraitRatio(second.ratio);

  if (firstPortrait === secondPortrait) return null;

  const portrait = firstPortrait ? first : second;
  const other = firstPortrait ? second : first;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  const naturalPortraitWidth = safeHeight * portrait.ratio;
  const portraitWidth = roundHalfPixel(Math.min(naturalPortraitWidth, safeWidth * 0.63));
  const portraitHeight = roundHalfPixel(Math.min(safeHeight, portraitWidth / portrait.ratio));
  const otherWidth = roundHalfPixel(safeWidth - portraitWidth - gap);

  // Stage too narrow for this split to leave the other card usable -- let the general packer
  // decide instead of ever placing an unusably thin card.
  if (portraitWidth < MIN_TILE_WIDTH || portraitHeight < MIN_TILE_HEIGHT || otherWidth < MIN_TILE_WIDTH) {
    return null;
  }

  const portraitTop = Math.max(0, roundHalfPixel((safeHeight - portraitHeight) / 2));
  const portraitCell: MixedAspectCell = { key: portrait.key, left: 0, top: portraitTop, width: portraitWidth, height: portraitHeight };
  const otherCell: MixedAspectCell = { key: other.key, left: 0, top: 0, width: otherWidth, height: safeHeight };

  // Keep each participant on the same SIDE they were passed in (left/right), not always
  // portrait-first -- preserves "the existing left/right two-participant arrangement" regardless
  // of which of the two happens to be on a phone.
  if (firstPortrait) {
    otherCell.left = portraitWidth + gap;
  } else {
    portraitCell.left = otherWidth + gap;
  }

  return {
    rows: 1,
    cells: firstPortrait ? [ portraitCell, otherCell ] : [ otherCell, portraitCell ],
    totalArea: (portraitWidth * portraitHeight) + (otherWidth * safeHeight),
  };
}

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

  // Exactly-two-participants, exactly-one-portrait gets its own dedicated split (see that
  // function's own comment for why) -- tried first, before the general row-count search below.
  const twoParticipantSpecialCase = calculateTwoParticipantMixedLayout(safeCards, safeWidth, safeHeight, gap);

  if (twoParticipantSpecialCase) return twoParticipantSpecialCase;

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
// --- Mobile aspect-aware two-column gallery packing -----------------------------------------
// The general mixed-aspect engine above (calculateMixedAspectLayout) searches over ROW count and
// lets each row's own height float freely to whatever makes that row's combined ratios fill the
// stage width -- correct for the normal desktop gallery, but on a narrow mobile viewport it can
// legitimately decide a single full-width row packs more total area than two narrower columns,
// exactly the "everything stacks into one column" bug the mobile forced-2-column rule
// (MeetingLayoutInput.forceColumns) exists to prevent for the uniform engine. Mobile 4+ Gallery
// View needs that same hard two-column constraint, but -- unlike calculateForcedColumnLayout --
// must still size each card to its OWN real ratio: a 9:16 portrait stream must render as a
// genuinely 9:16 outer card, never cropped or stretched to fill a shared uniform cell (see
// TOOWIX_MOBILE_PORTRAIT_GALLERY_FIX_PLAN.md section 4).
//
// Algorithm (plan section 4, "recommended first implementation"): pair cards into rows of up to
// two, IN ORIGINAL ORDER -- preserves reading/swipe order, unlike a masonry/balanced-column
// approach which would reorder cards unpredictably. Every card in a row shares the SAME column
// width (half the stage width, minus one fixed gap); a row's height is the TALLER of its (up to
// two) cards' natural heights at that column width, and the shorter card is vertically centered
// within the row rather than stretched to match it. The whole stack is then uniformly scaled DOWN
// (never up -- same "only ever shrink to fit" policy as every other engine in this file) if it
// would otherwise overflow the stage height, so every card keeps its exact real ratio at every
// stage size. A lone last-row card keeps the SAME column width as a paired row (never doubles to
// fill the row), so it reads as "one tile at the same scale" rather than an unexpectedly giant crop.
//
// Gaps are fixed CSS pixels, not scaled with content -- consistent with layoutForRowCount's own
// policy elsewhere in this file (the plan's own pseudocode flags a scaled-gap variant as an
// alternative; fixed gaps were chosen for consistency with the rest of this module).
//
// No minimum-tile-size rejection here (unlike sizeForStructure/layoutForRowCount): exactly two
// columns, up to 8 cards/page and real aspect ratios can be geometrically impossible to keep above
// any given minimum tile size on a very small or unusual viewport. Phase 1 of the plan explicitly
// chooses to keep 8/page with no scrolling and scale the whole page down rather than changing
// pagination or cropping a card's real ratio -- so this function always returns a usable layout
// rather than ever returning null.
function safeAspectRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_CARD_RATIO;
}

function chunkPairs<T>(items: T[]): T[][] {
  const pairs: T[][] = [];

  for (let index = 0; index < items.length; index += 2) {
    pairs.push(items.slice(index, index + 2));
  }

  return pairs;
}

export function calculateMobileAspectAwareLayout(
  cards: MixedAspectCardInput[], width: number, height: number, gap = 12,
): MixedAspectLayoutResult {
  // Defensive clamp, same reasoning as calculateForcedColumnLayout's own: the caller is expected
  // to already hand this at most one page's worth of cards, but this keeps a chunking bug from
  // ever producing more rows than a single mobile page is supposed to hold.
  const pageCards = cards.slice(0, MOBILE_GALLERY_TILES_PER_PAGE);
  const safeCards = pageCards.length > 0 ? pageCards : [ { key: '__empty__', ratio: DEFAULT_CARD_RATIO } ];
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const rowsOfCards = chunkPairs(safeCards);
  const columnWidth = Math.max(1, (safeWidth - gap) / 2);

  const rowNaturalHeights = rowsOfCards.map((row) => (
    Math.max(...row.map((card) => columnWidth / safeAspectRatio(card.ratio)))
  ));
  const sumNaturalHeights = rowNaturalHeights.reduce((sum, h) => sum + h, 0);
  const availableForRows = safeHeight - gap * Math.max(0, rowsOfCards.length - 1);
  const scale = sumNaturalHeights > 0 && availableForRows > 0
    ? Math.min(1, availableForRows / sumNaturalHeights)
    : 1;
  const cellWidth = roundHalfPixel(columnWidth * scale);
  const scaledRowHeights = rowNaturalHeights.map((h) => roundHalfPixel(h * scale));
  const totalContentHeight = scaledRowHeights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, rowsOfCards.length - 1);
  const top0 = Math.max(0, roundHalfPixel((safeHeight - totalContentHeight) / 2));

  const cells: MixedAspectCell[] = [];
  let totalArea = 0;
  let top = top0;

  rowsOfCards.forEach((row, rowIndex) => {
    const rowHeight = scaledRowHeights[rowIndex];
    const rowContentWidth = row.length === 2 ? cellWidth * 2 + gap : cellWidth;
    const left0 = Math.max(0, roundHalfPixel((safeWidth - rowContentWidth) / 2));

    row.forEach((card, columnIndex) => {
      // Derived directly from this card's own ratio (not clamped against rowHeight) so the
      // rendered card is always EXACTLY its real ratio, never approximated -- rowHeight is by
      // construction already the max over the row, so this is always <= rowHeight.
      const cardHeight = roundHalfPixel(cellWidth / safeAspectRatio(card.ratio));
      const cardTop = roundHalfPixel(top + (rowHeight - cardHeight) / 2);
      const cardLeft = left0 + columnIndex * (cellWidth + gap);

      cells.push({ key: card.key, left: cardLeft, top: cardTop, width: cellWidth, height: cardHeight });
      totalArea += cellWidth * cardHeight;
    });
    top += rowHeight + gap;
  });

  return { rows: rowsOfCards.length, cells, totalArea };
}

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
// The engines above (uniform, mixed-aspect, mobile-aspect-aware) all treat a card's real/preferred
// ratio as something to PRESERVE exactly, which necessarily leaves unfilled stage area whenever the
// participant mix doesn't tile perfectly at that ratio (the "big empty bands" regression this
// section fixes). This engine inverts the priority: ratio is only a PREFERENCE that nudges relative
// tile proportions, while 100% of the usable stage (minus fixed gaps) is always tiled by construction.
//
// Algorithm -- weighted row/column tessellation: partition the N cards into R rows (same stable,
// original-order partitioning as partitionIntoRows below), then:
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

// Same stable, original-order partitioning as the mixed-aspect engine's partitionIntoRows: columns
// = ceil(count / rows), every row that size except a shorter final row. Reused here (not imported,
// to keep this section's dependency graph self-contained) under its own name for clarity.
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

  for (let rowCount = 1; rowCount <= safeTiles.length; rowCount += 1) {
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
 * worth the disruption -- same hysteresis role chooseStableLayout/chooseStableMixedAspectLayout
 * play for the other engines, just comparing this engine's own cost function instead of area.
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
