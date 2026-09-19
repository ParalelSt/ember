import type { PickerOption } from '@/components/library/options';

import type { TabsScroll, TabsStaff } from '@/lib/tabScore';

export type { TabsScroll, TabsStaff } from '@/lib/tabScore';
export type TabsLayout = 'sheet' | 'side-panel' | 'stage';

/** Where the tab lives (docs/tabs-rebuild.md section 6), in picker order.
 *  `id` is what persists to localStorage; `badge` marks the owner's pick;
 *  `description` is the line under the preview. */
export const TABS_LAYOUTS: (PickerOption & { id: TabsLayout; badge?: string })[] = [
  {
    id: 'sheet',
    name: 'Sheet page',
    badge: 'Recommended',
    description:
      'A. Its own page, /tabs/[trackId]. A sticky toolbar on top (tracks, Tab or Tab + Score, speed, loop, count-in, horizontal scroll), the score fills the content column and the player bar stays below. Phone: the same page, full screen. The chosen home; Horizontal is the toggle inside it.',
  },
  {
    id: 'side-panel',
    name: 'Side panel',
    description:
      'B. On desktop the tab docks in a right column like Lyrics, so you keep browsing while it scrolls. On phone it is a full-screen sheet opened from Now playing. Reads best with Scroll set to Horizontal.',
  },
  {
    id: 'stage',
    name: 'Stage',
    description:
      'C. Full-bleed dark score with everything else hidden, and a floating translucent toolbar over the bottom edge. Songsterr\'s scroll mode is Horizontal here: one row, the cursor holds a third of the way in.',
  },
];

export const TABS_STAFF: (PickerOption & { id: TabsStaff })[] = [
  { id: 'tab', name: 'Tab', description: 'Tab staff only, with rhythm stems and beams under the numbers.' },
  { id: 'score-tab', name: 'Tab + Score', description: 'Standard notation above the tab staff.' },
];

export const TABS_SCROLL: (PickerOption & { id: TabsScroll })[] = [
  { id: 'vertical', name: 'Vertical', description: 'Page layout: rows of bars that wrap, the page scrolls down.' },
  { id: 'horizontal', name: 'Horizontal', description: 'One endless row that scrolls sideways, like Songsterr.' },
];

export type TabsPaste = 'dialog' | 'inline';

/** How pasting a text tab looks (docs/tab-sources.md section 6), in picker
 *  order. The owner picks one by name before the live paste UI is built. */
export const TABS_PASTE: (PickerOption & { id: TabsPaste; badge?: string })[] = [
  {
    id: 'dialog',
    name: 'Paste dialog',
    badge: 'Recommended',
    description:
      'A. "Paste a tab" on the empty tab page opens a dialog: the text on the left, the real score on the right as you paste, the report ("6 strings, Drop D, 9 bars") and the tempo row underneath, Save in the footer. Tempo fits the song length by default; Tap along is the other way. Phone: full screen, stacked, text first.',
  },
  {
    id: 'inline',
    name: 'Inline editor',
    description:
      'B. The empty tab page itself becomes the editor: tempo, report and Save in the sticky toolbar, the text on top and the score below it, where the tab will sit once saved. Phone: the same, stacked.',
  },
];
