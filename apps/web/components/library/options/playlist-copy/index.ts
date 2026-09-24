import type { PickerOption } from '@/components/library/options';

/** Design candidates for copying songs from one playlist to another
 *  (docs/superpowers/plans/2026-09-24-playlist-copy.md, Task 0): select
 *  songs one by one or all at once, sort, and copy them into a playlist, a
 *  new playlist or Liked songs, with duplicates skipped. Mock data only;
 *  the build stage builds the winner. */

export type CopyOptionId = 'checkbox-bar' | 'tap-select' | 'copy-dialog';

/** The flow, one step per picker entry, so every frame can be put at any
 *  point of it (and screenshotted there). Each frame is clickable from
 *  there on too. */
export type CopyStepId = 'start' | 'select' | 'all' | 'sort' | 'picker' | 'liked' | 'result';

export interface CopyOption extends PickerOption {
  id: CopyOptionId;
  badge?: string;
}

export const COPY_RECOMMENDED: CopyOptionId = 'checkbox-bar';

export const COPY_RECOMMENDED_REASON =
  'Select, Select all and Sort sit on the page where the songs already are (so Sort is useful even when you are not copying), and one bottom bar reads the same under a thumb on a phone and a mouse on desktop.';

/** Picker order; `id` is what persists to localStorage. */
export const COPY_OPTIONS: CopyOption[] = [
  {
    id: 'checkbox-bar',
    name: 'Checkbox column',
    description:
      'A Select button in the action bar turns the play column into checkboxes, with Select all and Sort in a row above the list; a bar sticks to the bottom with the count and Copy to…',
    badge: 'Recommended',
  },
  {
    id: 'tap-select',
    name: 'Tap to select',
    description:
      'Phone-first: press and hold a song (or tap its cover on desktop) to start selecting; the top bar turns into a selection bar with Select all, Sort and Copy, and sheets slide up for the rest.',
  },
  {
    id: 'copy-dialog',
    name: 'Copy songs dialog',
    description:
      'A Copy songs button opens a dialog with its own list, checkboxes and sort; the page itself never changes. Where to, the Liked warning and the result are steps inside the same dialog.',
  },
];

export const COPY_STEPS: (PickerOption & { id: CopyStepId })[] = [
  { id: 'start', name: 'The page', description: 'The playlist page before anything is picked: where the way in is.' },
  { id: 'select', name: 'Select one by one', description: 'Select mode with three songs picked.' },
  { id: 'all', name: 'Select all', description: 'Every song picked; the same control clears it again.' },
  { id: 'sort', name: 'Sort', description: 'The sort choices open: title, artist, date added, duration, each both ways.' },
  { id: 'picker', name: 'Copy to…', description: 'Where to: New playlist, Liked songs and the playlists, each with how many are already there.' },
  { id: 'liked', name: 'Liked songs warning', description: 'Copying into Liked songs likes every one of them: said plainly before it happens.' },
  { id: 'result', name: 'Result', description: 'What happened: added, and skipped because already there.' },
];
