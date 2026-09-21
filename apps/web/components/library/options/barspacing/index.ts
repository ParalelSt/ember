/** How far left the play and next buttons sit on the phone player bar.
 *  Layout, colours and the "Aligned" spacing are fixed (the owner's picks);
 *  only the row's right padding changes, and with it where the seek line
 *  ends. Each option is a set of descendant overrides on a wrapper around
 *  the REAL bar in the gallery, so the candidates restyle what ships.
 *
 *  Shipped today: next's icon ends 16px from the screen edge, the same as
 *  the artwork on the left, and the seek line ends right under it. */
export type BarSpacingId = 'aligned' | 'left-8' | 'left-12' | 'left-20' | 'left-12-line';

export interface BarSpacingOption {
  id: BarSpacingId;
  label: string;
  /** One line: what changes. */
  blurb: string;
  /** Descendant overrides for the wrapper around the shell preview. */
  className: string;
}

// The targets: the row (artwork, name, buttons) and the seek line's wrapper
// (the element right after the row). Next's 24px icon sits 12px inside its
// 48px hit box, so the icon's gap to the edge is the row's right padding
// plus 12. Written out in full, never built from pieces: Tailwind only
// generates class names it can read literally in the source.
export const BAR_SPACING_OPTIONS: BarSpacingOption[] = [
  {
    id: 'aligned',
    label: 'As it is now (Aligned)',
    blurb: 'For comparison. The next icon ends 16px from the edge, the line under it.',
    className: '',
  },
  {
    id: 'left-8',
    label: '8px left',
    blurb: 'The next icon ends 24px from the edge, the same margin the page content uses. The line still ends under it.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-row [&_[data-testid=phone-player-row]+div]:pr-stack',
  },
  {
    id: 'left-12',
    label: '12px left',
    blurb: 'The next icon ends 28px from the edge. The line still ends under it.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-block [&_[data-testid=phone-player-row]+div]:pr-[28px]',
  },
  {
    id: 'left-20',
    label: '20px left',
    blurb: 'The next icon ends 36px from the edge, clearly away from it. The line still ends under it.',
    className:
      '[&_[data-testid=phone-player-row]]:pr-stack [&_[data-testid=phone-player-row]+div]:pr-[36px]',
  },
  {
    id: 'left-12-line',
    label: '12px left, line stays',
    blurb: 'The buttons move 12px left, but the line keeps running to 16px from the edge, even on both sides.',
    className: '[&_[data-testid=phone-player-row]]:pr-block',
  },
];

export const BAR_SPACING_RECOMMENDED: BarSpacingId = 'left-8';
export const BAR_SPACING_RECOMMENDED_REASON =
  '8px left puts the next icon on the same 24px margin as the page above it, so the bar lines up with the page instead of hugging the edge.';
