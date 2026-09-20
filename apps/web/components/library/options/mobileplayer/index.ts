import type { PickerOption } from '@/components/library/options';

export type MobilePlayerLayout = 'one-row' | 'two-rows' | 'split';
export type MobileTitleOption = 'truncate' | 'scroll' | 'two-lines';
export type MobileInsetOption = 'safe-area' | 'today';

/** Android's three-button navigation bar is 48dp tall, which is both the
 *  height of the mock strip drawn over the frame and the inset the
 *  "Safe area" option lifts the shell by. */
export const ANDROID_NAV_PX = 48;

/** Tap boxes, in CSS px, for the phone bar as it ships today. Google's own
 *  guidance is 48px, Apple's 44pt; the numbers below are what the owner is
 *  actually pressing, and the candidates are measured against them. */
export const TODAY_TAPS = 'play 40px, prev/next 32px, queue 40px, artwork 48px';

/** The width today's bar leaves for the song name at 390, measured in the
 *  mock shell: the grid is [1fr auto 1fr], so the left column is
 *  (390 - 32 padding - 32 gaps - 128 transport) / 2 = 98px, of which the
 *  48px artwork and its 12px gap take 60. */
export const TODAY_TITLE_PX = 38;

export interface MobileLayoutOption extends PickerOption {
  id: MobilePlayerLayout;
  badge?: string;
  /** Measured tap boxes, shown in the section copy. */
  taps: string;
  /** Measured width of the song-name box at 390 and at 360. */
  titleBox: string;
}

export const MOBILE_PLAYER_LAYOUTS: MobileLayoutOption[] = [
  {
    id: 'one-row',
    name: 'One row, bigger',
    description:
      "Today's single row, with the controls grown to a comfortable touch size and the artwork one step smaller, so the name takes the space that frees up. Same 81px bar height as today, and every control stays in it.",
    taps: 'play 48px, prev/next 44px, queue 44px, artwork 40px',
    titleBox: '88px at 390, 58px at 360',
  },
  {
    id: 'two-rows',
    name: 'Two rows',
    badge: 'Recommended',
    description:
      "The name and artist get their own full-width line above a row of controls, so the name has the whole bar to itself and every button can be large. Costs about 50px of height: 133px against today's 81px.",
    taps: 'play 56px, prev/next 48px, queue 48px, artwork 48px',
    titleBox: '356px at 390, 326px at 360',
  },
  {
    id: 'split',
    name: 'Split',
    description:
      'The progress line moves to the very top edge of the bar, artwork and name sit left, and only play and next stay in the bar. Previous, queue, like and the rest live in the full-screen view. The shortest bar of all at 75px.',
    taps: 'play 56px, next 48px, artwork 44px',
    titleBox: '176px at 390, 146px at 360',
  },
];

export const MOBILE_TITLE_OPTIONS: (PickerOption & { id: MobileTitleOption; badge?: string })[] = [
  {
    id: 'truncate',
    name: 'Truncate',
    description: 'What ships now: one line, cut with an ellipsis. "Yes Sir, I Can Boogie" becomes "Yes ..." in today\'s bar.',
  },
  {
    id: 'scroll',
    name: 'Scroll',
    badge: 'Recommended',
    description:
      'The real MarqueeText from the full-screen view: a name that fits stays still, a name that overruns its box scrolls once a second has passed and loops with a gap.',
  },
  {
    id: 'two-lines',
    name: 'Two lines',
    description: 'The name wraps to a second line before it is cut, with the artist under it. The bar grows by one line when a name is long.',
  },
];

export const MOBILE_INSET_OPTIONS: (PickerOption & { id: MobileInsetOption; badge?: string })[] = [
  {
    id: 'safe-area',
    name: 'Safe area',
    badge: 'Recommended',
    description:
      'The bottom nav lifts itself clear of the system navigation with the safe-area inset, so nothing of Ember sits under Android\'s back, home and recents buttons.',
  },
  {
    id: 'today',
    name: 'Today',
    description:
      'What ships now: env(safe-area-inset-bottom) with a 0px fallback, which is what the Android WebView actually reports, so the row stays under the system buttons.',
  },
];
