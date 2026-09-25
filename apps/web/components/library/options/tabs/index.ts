import type { PickerOption } from '@/components/library/options';

import type { TabsScroll, TabsStaff } from '@/lib/tabScore';

export type { TabsScroll, TabsStaff } from '@/lib/tabScore';
export type TabsLayout = 'sheet' | 'side-panel' | 'stage';

/** Where the tab lives, in picker order.
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

export type TabsV3Picker = 'menu' | 'sheet';

/** How the found-online tabs are picked, in
 *  picker order. The owner picks one before stage 6 builds it. */
export const TABS_V3_PICKER: (PickerOption & { id: TabsV3Picker; badge?: string })[] = [
  {
    id: 'menu',
    name: 'Picker menu',
    badge: 'Recommended',
    description:
      'A. The source chip opens a dropdown under the header: every tab found online grouped by site, in rank order, then the ones on this server. One line each with the type and instruments underneath, the rating and votes on the right, and whether it is lined up with the recording. Search online again and Line it up again sit at the bottom. Phone: the same menu, the full width of the page.',
  },
  {
    id: 'sheet',
    name: 'Source sheet',
    description:
      'B. The source chip opens a side sheet on desktop and a bottom sheet on phone: a card per tab with the site, type, rating and votes, every instrument as a chip, the alignment with its confidence, and a two-bar preview of the notes. Roomier than the menu, one more tap to close.',
  },
];

export type TabsV3State = 'searching' | 'found' | 'not-lined-up' | 'nothing';

/** What the tab page shows while and after Ember looks online. */
export const TABS_V3_STATE: (PickerOption & { id: TabsV3State })[] = [
  {
    id: 'searching',
    name: 'Searching online',
    description:
      'The first visit to a song with no tab: a skeleton where the score will be and the sites being checked, one at a time. A few seconds; the result is kept, so this shows once per song.',
  },
  {
    id: 'found',
    name: 'Found and lined up',
    description:
      'The best match is drawn and follows the recording. The chip names the site and says it is lined up, with how sure Ember is.',
  },
  {
    id: 'not-lined-up',
    name: 'Not lined up yet',
    description:
      'A tab was found but Ember could not match it to the recording with confidence. It still draws from the top, with a calm note, a Line it up button and the Sync nudge open underneath.',
  },
  {
    id: 'nothing',
    name: 'Nothing online',
    description:
      'Nothing on Songsterr or Ultimate Guitar: the empty page with the search links, Paste a tab, Add a file, and Generate from the recording (rough) last.',
  },
];
