/** Colour options for the phone player bar and the nav under it. The layout
 *  is fixed (the owner's pick); only colour changes between these. Each one
 *  is a set of descendant overrides put on a wrapper around the REAL bar in
 *  the gallery, so the candidates restyle what ships instead of copying it.
 *
 *  Why this exists: the red ring on the seek dot is the only colour in the
 *  whole strip ("make it more consistent"). Every option either removes it
 *  or gives the red a consistent job. */
export type BarColorId = 'now' | 'mono' | 'ember-line' | 'ember-play' | 'quiet';

export interface BarColorOption {
  id: BarColorId;
  label: string;
  /** One line: what changes. */
  blurb: string;
  /** Descendant overrides for the wrapper around the shell preview. */
  className: string;
}

// The targets: the seek line's fill and dot (the shared Slider's own
// data-slots), the play disc, and the mock nav's active item. Written out
// in full, never built from pieces: Tailwind only generates class names it
// can read literally in the source.
export const BAR_COLOR_OPTIONS: BarColorOption[] = [
  {
    id: 'now',
    label: 'As it is',
    blurb: 'For comparison. White everywhere, except a red ring on the seek dot.',
    className: '',
  },
  {
    id: 'mono',
    label: 'All white',
    blurb: 'The red ring goes. White line, white dot, white play: one colour, nothing odd.',
    className: '[&_[data-slot=slider-thumb]]:border-foreground',
  },
  {
    id: 'ember-line',
    label: 'Ember line',
    blurb: 'Progress and where you are get the Ember red: the line, its dot and the active tab. Play stays white.',
    className: '[&_[data-slot=slider-range]]:bg-ring [&_[data-slot=slider-thumb]]:border-ring [&_[data-slot=slider-thumb]]:bg-ring [&_[data-testid=mock-mobile-nav]_.text-foreground]:text-ring',
  },
  {
    id: 'ember-play',
    label: 'Ember play',
    blurb: 'The red on everything you act on: play, the line, its dot and the active tab.',
    className: '[&_[data-testid=phone-play-disc]]:bg-ring [&_[data-testid=phone-play-disc]]:text-foreground [&_[data-slot=slider-range]]:bg-ring [&_[data-slot=slider-thumb]]:border-ring [&_[data-slot=slider-thumb]]:bg-ring [&_[data-testid=mock-mobile-nav]_.text-foreground]:text-ring',
  },
  {
    id: 'quiet',
    label: 'Quiet',
    blurb: 'Softer: play becomes a grey disc, the dot hides until you touch the line. White line only.',
    className: '[&_[data-testid=phone-play-disc]]:bg-foreground/15 [&_[data-testid=phone-play-disc]]:text-foreground [&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:border-foreground',
  },
];

export const BAR_COLOR_RECOMMENDED: BarColorId = 'ember-line';
export const BAR_COLOR_RECOMMENDED_REASON =
  'It keeps the one accent the bar already has (the red ring on the seek dot) and gives it one clear job: progress and where you are. Play stays the brightest thing on the bar.';
