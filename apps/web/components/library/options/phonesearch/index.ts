import type { PickerOption } from '@/components/library/options';

export type PhoneSearchOption = 'sheet-above' | 'search-page' | 'mini-player';
export type PhoneSearchState = 'typing' | 'playing' | 'empty';

export interface PhoneSearchCandidate extends PickerOption {
  id: PhoneSearchOption;
  badge?: string;
  /** What happens to the on-screen keyboard. */
  keyboard: string;
  /** What Android's back gesture (or button) does. */
  back: string;
  /** Every way out. */
  close: string;
}

/** The candidate marked Recommended, and the one line that says why. */
export const PHONE_SEARCH_RECOMMENDED: PhoneSearchOption = 'sheet-above';
export const PHONE_SEARCH_RECOMMENDED_REASON =
  'It keeps today’s instant sheet (no route change, works offline) and only moves its bottom edge, so the one real player bar, seek line and all, is right there the moment you press play.';

/** The three ways search could work on a phone, in the order the picker
 *  lists them. Proposals only: the live search is unchanged. */
export const PHONE_SEARCH_OPTIONS: PhoneSearchCandidate[] = [
  {
    id: 'sheet-above',
    name: 'Sheet above the player',
    badge: 'Recommended',
    description:
      'The full-screen search stays, but it ends at the top of the player bar: the bar and the bottom nav are never covered, so they are visible and usable the whole time you search.',
    keyboard:
      'Comes up when the sheet opens, as today, and covers the bottom of the screen, bar and nav with it. Tapping a result, scrolling the list or the Search key drops it, and the bar is right there.',
    back:
      'With the keyboard up, Back first drops the keyboard (Android does that itself). The next Back closes the sheet (the same useBackDismiss as today); the page under it never moved.',
    close:
      'The X in the box, Back, or Escape. Tapping Search in the nav again closes it; Home or Library close it and go there. Tapping the bar opens the full-screen player on top of the sheet, and closing that lands back on your results.',
  },
  {
    id: 'search-page',
    name: 'Search page',
    description:
      'Tapping Search goes to a normal page, like /search: the box at the top and the results below, inside the normal shell, so the player bar and the nav stay exactly where they always are.',
    keyboard:
      'The box takes focus when the page opens (autoFocus, like /search today), so the keyboard comes up over the bar and nav; it drops when a result is tapped or the list scrolls.',
    back:
      'Plain navigation: Back returns to the page you came from, at its scroll position. No history trick needed.',
    close:
      'Nothing to close, it is a page: leave with Back or any nav tab. The costs: a route change (the /search chunk has to load; offline, /search is wrapped in OnlineOnly and shows the offline notice instead of recents), and the query starts empty on every visit unless it moves into a store.',
  },
  {
    id: 'mini-player',
    name: 'Mini player in the sheet',
    description:
      'The full-screen sheet stays and still covers the bar and nav; while something plays, a compact now-playing strip (artwork, name, play/pause) is pinned to the bottom of the sheet.',
    keyboard:
      'Comes up on open, and the sheet shrinks to the space above it (it has to track visualViewport to do so), so the strip rides on the keyboard’s top edge and play/pause stays reachable while typing.',
    back:
      'Keyboard first, then the sheet, as today (useBackDismiss).',
    close:
      'The X, Back or Escape. Tapping the strip’s art or name would close the sheet and open the full-screen player. The real bar and nav stay hidden under the sheet: a second, smaller player to keep in sync, whose progress line cannot be dragged.',
  },
];

export const PHONE_SEARCH_STATES: (PickerOption & { id: PhoneSearchState })[] = [
  {
    id: 'typing',
    name: 'Typing',
    description: 'The keyboard is up, the box is focused with a query and results are listed. A song picked earlier is still playing.',
  },
  {
    id: 'playing',
    name: 'Playing from search',
    description: 'A result was tapped: its title in ember, pause on its row, the keyboard down, and the player showing it.',
  },
  {
    id: 'empty',
    name: 'Nothing typed',
    description: 'Just opened, keyboard dropped: recent searches only. A song picked earlier is still playing.',
  },
];
