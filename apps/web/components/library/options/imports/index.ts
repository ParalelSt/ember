import type { PickerOption } from '@/components/library/options';

export type ImportChoiceStyle = 'tabs' | 'cards' | 'smart-field';
export type ImportStep = 'choose' | 'pasted' | 'importing' | 'done';
export type ImportReviewStyle = 'inline' | 'sheet' | 'page';
export type ImportSourceId = 'spotify' | 'ytm' | 'spotify-long';

/** How the create-playlist dialog offers "Start empty" vs "Import from a
 *  link". `id` is what persists to localStorage. */
export const IMPORT_CHOICE_STYLES: (PickerOption & { id: ImportChoiceStyle })[] = [
  {
    id: 'tabs',
    name: 'Tabs',
    description:
      'Two tabs under the dialog title, "Start empty" first. Import is one click away and the dialog keeps its size when you switch.',
  },
  {
    id: 'cards',
    name: 'Cards',
    description:
      'The dialog opens on two large cards. Picking Import slides to the link step, with Back to return; Start empty slides to today\'s name and songs form.',
  },
  {
    id: 'smart-field',
    name: 'Smart field',
    description:
      'One field. Type a name and it is today\'s dialog; paste a Spotify or YouTube Music link and the same dialog turns into the import preview.',
  },
];

export const IMPORT_STEPS: (PickerOption & { id: ImportStep })[] = [
  { id: 'choose', name: 'Choose', description: 'The dialog just opened from the + next to Playlists.' },
  { id: 'pasted', name: 'Link pasted', description: 'A link is in: the preview with cover, name, song count and source.' },
  {
    id: 'importing',
    name: 'Importing',
    description:
      'Create was pressed: the dialog is gone, the playlist is already in the sidebar with a progress ring, and its page fills in as songs are matched.',
  },
  {
    id: 'done',
    name: 'Done',
    description: 'Finished: a summary of what was added, what needs a look and what was not found, with Review.',
  },
];

export const IMPORT_REVIEW_STYLES: (PickerOption & { id: ImportReviewStyle })[] = [
  {
    id: 'inline',
    name: 'Inline',
    description:
      'Uncertain songs stay in the playlist with a Pick button; it opens a popover of YouTube candidates right under the row.',
  },
  {
    id: 'sheet',
    name: 'Side sheet',
    description:
      'A sheet on the right walks the uncertain songs one at a time: keys 1 to 3 pick, S skips. On phone it is a bottom sheet.',
  },
  {
    id: 'page',
    name: 'Review page',
    description:
      'A full review queue: every uncertain song with its best candidate already chosen, so one "Accept all" usually finishes it.',
  },
];

/** Which link is pasted in the preview. Not persisted: it only exists to
 *  show the YouTube Music badge and the Spotify 100-song note. */
export const IMPORT_SOURCES: (PickerOption & { id: ImportSourceId })[] = [
  { id: 'spotify', name: 'Spotify', description: 'A 42-song Spotify playlist.' },
  { id: 'ytm', name: 'YouTube Music', description: 'The same playlist on YouTube Music.' },
  { id: 'spotify-long', name: 'Spotify, over 100', description: 'A 318-song Spotify playlist: only the first 100 come across.' },
];

/** Songs Spotify's public embed page lists (docs/imports.md, decision 1). */
export const SPOTIFY_EMBED_CAP = 100;
