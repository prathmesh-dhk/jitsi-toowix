import { useRef } from 'react';

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
}

export interface MeetingLayoutResult {
  columns: number;
  rows: number;
  ratio: MeetingCardRatio;
  cardWidth: number;
  cardHeight: number;
}

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
 * Pure per-candidate sizing: given a specific column count and ratio, what card size does that
 * produce at this width/height? Returns null if the cards would be smaller than the enforced
 * minimum (an unusable candidate, never offered as a switch target, and a signal that the
 * CURRENT structure -- if this is being used to re-evaluate it -- no longer fits).
 */
function sizeForStructure(
  count: number, columns: number, ratio: MeetingCardRatio, width: number, height: number, gap: number,
): MeetingLayoutResult | null {
  const ratioValue = RATIO_VALUES[ratio];
  const rows = Math.ceil(count / columns);
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const cellHeight = (height - gap * (rows - 1)) / rows;

  if (cellWidth <= 0 || cellHeight <= 0) return null;

  const cardWidth = Math.min(cellWidth, cellHeight * ratioValue);
  const cardHeight = cardWidth / ratioValue;

  if (cardWidth < MIN_TILE_WIDTH || cardHeight < MIN_TILE_HEIGHT) return null;

  return { columns, rows, ratio, cardWidth: roundHalfPixel(cardWidth), cardHeight: roundHalfPixel(cardHeight) };
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

  return best || {
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

/**
 * React hook wrapping chooseStableLayout with the previous structure remembered across renders
 * (a ref, not component state -- it never needs to trigger its own re-render). The decision is
 * a pure function of (previous structure, current size): no clock reads during render, so two
 * renders with identical inputs always produce identical output -- a time-based hold here made
 * consecutive renders disagree and was a direct cause of the flicker.
 *
 * Card geometry is recalculated every call; only columns/rows/ratio are held stable. Call once
 * per render with the latest measured width/height.
 */
export function useStableMeetingLayout(input: MeetingLayoutInput): MeetingLayoutResult {
  const layoutRef = useRef<MeetingLayoutResult | null>(null);
  const next = chooseStableLayout(input, layoutRef.current);

  layoutRef.current = next;

  return next;
}
