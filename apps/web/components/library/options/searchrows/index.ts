import type { PickerOption } from '@/components/library/options';

export type RowState = 'idle' | 'playing' | 'paused';

/** What the player is doing, so the chosen row treatment can be seen in all
 *  three cases. The control-style and indicator pickers are gone: the owner
 *  picked "Trailing button" + "Ember title" (no glyph) and the section now
 *  renders the real production rows, which only have that one shape. */
export const ROW_STATES: (PickerOption & { id: RowState })[] = [
  { id: 'idle', name: 'Nothing playing', description: 'No row is the current one: only the hover and focus controls exist.' },
  { id: 'playing', name: 'This row playing', description: 'One row is the current one and the player is running.' },
  { id: 'paused', name: 'This row paused', description: 'The same row is still the current one, with the player paused.' },
];
