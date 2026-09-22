import type { PickerOption } from '@/components/library/options';

/** Design candidates for Transfer (docs/superpowers/plans/2026-09-22-transfer-liked-songs.md,
 *  Task 0): where it starts, how the destination is said, and the Liked
 *  page while a transfer runs. Mock data only, no real transfer exists
 *  yet: Tasks 1-4 build the pipeline this draws a front end for. */

export type TransferEntryId = 'liked-button' | 'dialog-tab' | 'settings-row';
export type TransferDestinationId = 'segmented' | 'cards' | 'implicit';
export type TransferStateId = 'idle' | 'running' | 'done';

export interface TransferEntryOption extends PickerOption {
  id: TransferEntryId;
}

export interface TransferDestinationOption extends PickerOption {
  id: TransferDestinationId;
}

/** Where Transfer starts (plan 2.7, question 1). */
export const TRANSFER_ENTRY_OPTIONS: TransferEntryOption[] = [
  {
    id: 'liked-button',
    name: 'Transfer button on Liked songs',
    description:
      'A "Transfer" button next to Play and Shuffle in the Liked songs header, opening its own dialog. The songs land on this page, so the running transfer and its review live right here too.',
  },
  {
    id: 'dialog-tab',
    name: 'Third tab in Create playlist',
    description:
      'A "Transfer" tab in the existing create-playlist dialog, next to "Start empty" and "Import from a link". One dialog for every way songs come from outside Ember.',
  },
  {
    id: 'settings-row',
    name: 'Settings row',
    description:
      'Settings has a "Library" section with a "Transfer from another app" row that opens the same dialog. Out of the way until someone goes looking for it.',
  },
];

export const TRANSFER_ENTRY_RECOMMENDED: TransferEntryId = 'liked-button';

/** How the destination is said (plan 2.7, question 2). Shown inside the
 *  same source-step dialog with a different control per candidate. */
export const TRANSFER_DESTINATION_OPTIONS: TransferDestinationOption[] = [
  {
    id: 'segmented',
    name: 'Segmented control',
    description:
      'A two-way "Liked songs / New playlist" control above the Start button, always visible, so the same dialog can send songs either place no matter how it was opened.',
  },
  {
    id: 'cards',
    name: 'Two cards',
    description:
      'After the source preview, two large cards with a one-line consequence under each: "These become your likes and shape your mixes" or "A playlist you can edit and share".',
  },
  {
    id: 'implicit',
    name: 'Implied by entry point',
    description:
      'No destination step at all: opening Transfer always means likes; opening "Import from a link" always means a playlist. One less decision, at the cost of no way to import a link straight to likes.',
  },
];

export const TRANSFER_DESTINATION_RECOMMENDED: TransferDestinationId = 'implicit';

export const TRANSFER_RECOMMENDED_REASON =
  'Transfer button on Liked songs, with the destination implied by that entry point: the songs already land on the page that shows them, so the running transfer, its progress and its review sit exactly where the owner will look for them, and nobody has to answer "where do these go" when the button they pressed already said so. The segmented control still earns its place inside "Import from a link", so a pasted playlist link can become likes too.';

/** The Liked page while a transfer runs (plan 2.7, drawn alongside the two
 *  questions above, no separate pick). */
export const TRANSFER_STATES: (PickerOption & { id: TransferStateId })[] = [
  { id: 'idle', name: 'Nothing yet', description: 'No transfer has run: the Liked page looks exactly as it does today.' },
  {
    id: 'running',
    name: 'Running',
    description: '240 of 1200 songs checked so far; 18 already need a look. The banner and the "Transferring" block sit above the real likes.',
  },
  {
    id: 'done',
    name: 'Done, some missing',
    description: 'Finished: 1042 added, 79 already liked, 61 to check, 18 not found on YouTube Music.',
  },
];
