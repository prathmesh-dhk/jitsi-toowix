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

/**
 * Finds the equal-card layout that gives each person the largest visible area.
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
    const ratioValue = RATIO_VALUES[ratio];
    for (let columns = 1; columns <= count; columns += 1) {
      const rows = Math.ceil(count / columns);
      const cellWidth = (width - gap * (columns - 1)) / columns;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      if (cellWidth <= 0 || cellHeight <= 0) continue;

      const cardWidth = Math.min(cellWidth, cellHeight * ratioValue);
      const cardHeight = cardWidth / ratioValue;
      const candidate: MeetingLayoutResult = { columns, rows, ratio, cardWidth, cardHeight };

      // Prefer larger cards. A small tolerance avoids ratio/column flicker when a
      // ResizeObserver reports sub-pixel changes while a panel animates.
      if (!best || candidate.cardWidth * candidate.cardHeight > best.cardWidth * best.cardHeight + 1) {
        best = candidate;
      }
    }
  }

  return best || { columns: 1, rows: count, ratio: '16:9', cardWidth: width, cardHeight: width / (16 / 9) };
}
