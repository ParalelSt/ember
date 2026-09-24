import type { PickerOption } from '@/components/library/options';

/** Desktop top bar (the search pill area in app/(app)/layout.tsx). Today
 *  the pill's wrapper sits in flow ABOVE `data-app-scroller`, so the
 *  scroller and its scrollbar start about 80px down the window, and a
 *  scrolled page runs right up against the pill's bottom edge (a sticky
 *  24px fade is all that softens it).
 *
 *  The owner's three rounds of feedback, in order: content looks cut off
 *  under the pill; a 16px padded gap pushed the page and the scrollbar
 *  down, rejected; the fade alone leaves the scrollbar low and the pill
 *  touching the content. So candidates a to c all move the bar INTO the
 *  scroller (sticky, so the scrollbar runs the full height of the column)
 *  and keep a 16px band under the pill that scrolled content never shows
 *  in, drawn by the bar's own covering background, never by layout. At
 *  scroll top the heading still sits 32px under the pill, as today. */
export type TopBarId = 'float' | 'frosted' | 'solid' | 'now';

export interface TopBarCandidate extends PickerOption {
  id: TopBarId;
  /** false only for "As it is": the scroller starts under the bar. */
  fullHeightScroller: boolean;
  /** Where the scrollbar's track starts, in the frame's own px from the
   *  top of the content column. */
  scrollbarTopPx: number;
  /** The pill's bottom edge, px from the top of the column. */
  pillBottomPx: number;
  /** The covered band under the pill that scrolled content never shows
   *  in, px. 0 for "As it is" (that is the owner's complaint). */
  bandPx: 0 | 16;
  /** Pill bottom to the page heading at scroll top, px. 32 everywhere:
   *  no candidate may add distance there. */
  headingGapPx: 32;
}

/** Heights behind the numbers above: pt-page-lg is 32, the pill is h-12
 *  (48), py-block is 16. */
export const PILL_H = 48;

export const TOPBAR_RECOMMENDED: TopBarId = 'float';
export const TOPBAR_RECOMMENDED_REASON =
  'It fixes all three complaints at once (scrollbar from the very top, a clean 16px band under the pill, heading exactly where it is today) while the bar still looks the way the owner already knows, just with the page sliding away under it.';

export const TOPBAR_OPTIONS: TopBarCandidate[] = [
  {
    id: 'float',
    name: 'Floating pill',
    description:
      'The pill floats over a full-height scroller. No strip, no border: the page background covers the pill row plus a 16px band under it, then a 24px fade, both only visible once content scrolls under.',
    fullHeightScroller: true,
    scrollbarTopPx: 0,
    pillBottomPx: 80,
    bandPx: 16,
    headingGapPx: 32,
  },
  {
    id: 'frosted',
    name: 'Frosted bar',
    description:
      'A translucent strip with a strong blur across the whole column (pill row plus a 16px band), over a full-height scroller. A hairline divider appears under it only once the page is scrolled.',
    fullHeightScroller: true,
    scrollbarTopPx: 0,
    pillBottomPx: 80,
    bandPx: 16,
    headingGapPx: 32,
  },
  {
    id: 'solid',
    name: 'Solid strip',
    description:
      'A classic app bar in the sidebar colour with a subtle bottom border, 16px above and below the pill, over a full-height scroller. The page starts 16px higher than today.',
    fullHeightScroller: true,
    scrollbarTopPx: 0,
    pillBottomPx: 64,
    bandPx: 16,
    headingGapPx: 32,
  },
  {
    id: 'now',
    name: 'As it is',
    description:
      'For comparison: the bar sits above the scroller, so the scrollbar starts 80px down, and scrolled content runs straight up to the pill under a 24px fade.',
    fullHeightScroller: false,
    scrollbarTopPx: 80,
    pillBottomPx: 80,
    bandPx: 0,
    headingGapPx: 32,
  },
];
