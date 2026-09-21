/** Spacing options for the phone player bar. The layout and the colours are
 *  fixed (the owner's picks: "Old + play only" plus next, colours as they
 *  are); only padding and gaps change between these. Each option is a set
 *  of descendant overrides on a wrapper around the REAL bar in the gallery,
 *  so the candidates restyle what ships instead of copying it.
 *
 *  What is off today: the seek line runs 12px from the edges while the row
 *  above it sits 16px in, and the next glyph stops 28px from the right edge
 *  while the line runs on to 12px, so neither end lines up. */
export type BarSpacingId = 'now' | 'aligned' | 'roomy' | 'compact' | 'edge';

export interface BarSpacingOption {
  id: BarSpacingId;
  label: string;
  /** One line: what changes. */
  blurb: string;
  /** Descendant overrides for the wrapper around the shell preview. */
  className: string;
}

// The targets: the row (artwork, name, buttons), the artwork-to-name gap
// (the title row), the play/next group (the row's last child) and the seek
// line's wrapper (the element right after the row). Written out in full,
// never built from pieces: Tailwind only generates class names it can read
// literally in the source.
export const BAR_SPACING_OPTIONS: BarSpacingOption[] = [
  {
    id: 'now',
    label: 'As it is',
    blurb: 'For comparison. The line starts left of the artwork and runs past the next button.',
    className: '',
  },
  {
    id: 'aligned',
    label: 'Aligned',
    blurb: 'Same sizes, edges lined up: the line starts under the artwork and ends under the next icon.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-inset [&_[data-testid=phone-player-row]+div]:px-block',
  },
  {
    id: 'roomy',
    label: 'Roomy',
    blurb: 'Aligned, plus more air: a bigger gap after the artwork and between play and next, more above the row.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-inset [&_[data-testid=phone-player-row]]:pt-block [&_[data-testid=phone-player-row]]:pb-row [&_[data-testid=phone-player-title-row]]:gap-block [&_[data-testid=phone-player-row]>div:last-child]:gap-cluster [&_[data-testid=phone-player-row]+div]:px-block',
  },
  {
    id: 'compact',
    label: 'Compact',
    blurb: 'Aligned, and tighter top to bottom: the line tucks up under the row, the bar gets shorter.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-inset [&_[data-testid=phone-player-row]]:pt-cluster [&_[data-testid=phone-player-row]]:pb-inset [&_[data-testid=phone-player-row]+div]:px-block [&_[data-testid=phone-player-row]+div]:-mt-cluster',
  },
  {
    id: 'edge',
    label: 'Edge to edge',
    blurb: 'The row lined up on the right as in Aligned, and the line running the full width of the screen.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-inset [&_[data-testid=phone-player-row]+div]:px-0',
  },
];

export const BAR_SPACING_RECOMMENDED: BarSpacingId = 'aligned';
export const BAR_SPACING_RECOMMENDED_REASON =
  'Aligned fixes the one thing that looks off, both ends of the line, and changes nothing else you already liked.';
