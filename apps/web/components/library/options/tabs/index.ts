import type { PickerOption } from '@/components/library/options';

export type TabsLayout = 'sheet' | 'side-panel' | 'stage';
export type TabsStaff = 'tab' | 'score-tab';
export type TabsScroll = 'vertical' | 'horizontal';

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
