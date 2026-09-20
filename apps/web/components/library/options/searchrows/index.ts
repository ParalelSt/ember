import type { PickerOption } from '@/components/library/options';

export type RowControl = 'on-art' | 'trailing' | 'leading';
export type RowIndicator = 'bars' | 'ember-title' | 'tinted';
export type RowState = 'idle' | 'playing' | 'paused';

/** Where the press-to-play control lives inside a search overlay row, in
 *  picker order. `id` is what persists to localStorage; `description` is
 *  the line under the preview. */
export const ROW_CONTROLS: (PickerOption & { id: RowControl })[] = [
  {
    id: 'on-art',
    name: 'On the art',
    description:
      'Hover or keyboard-focus a row and its artwork dims behind a play triangle; the playing row shows pause there without needing a hover. Closest to the collection pages, and it adds no new column.',
  },
  {
    id: 'trailing',
    name: 'Trailing button',
    description:
      'A play/pause button at the right end of the row, next to the other row actions. Hidden until hover or focus, always shown on the playing row.',
  },
  {
    id: 'leading',
    name: 'Leading slot',
    description:
      'A fixed column before the artwork, empty until the row is hovered or focused, holding the playing state the rest of the time. Nothing shifts when the control appears, at the cost of a permanent gutter.',
  },
];

/** How a row says "this is the song playing", in picker order. */
export const ROW_INDICATORS: (PickerOption & { id: RowIndicator })[] = [
  {
    id: 'bars',
    name: 'Bars',
    description:
      'Three small ember bars where the artwork (or the lead slot) is, dancing while the song plays and standing still when it is paused.',
  },
  {
    id: 'ember-title',
    name: 'Ember title',
    description:
      "The row's title in the ember accent with a small speaker glyph beside it, which turns into a pause glyph when the song is paused.",
  },
  {
    id: 'tinted',
    name: 'Tinted row',
    description:
      'A faint ember wash over the whole row and a thin ember edge down its left side, plus the same small speaker or pause glyph.',
  },
];

/** What the player is doing, so every control and indicator can be seen in
 *  all three cases. */
export const ROW_STATES: (PickerOption & { id: RowState })[] = [
  { id: 'idle', name: 'Nothing playing', description: 'No row is the current one: only the hover and focus controls exist.' },
  { id: 'playing', name: 'This row playing', description: 'One row is the current one and the player is running.' },
  { id: 'paused', name: 'This row paused', description: 'The same row is still the current one, with the player paused.' },
];

/** The combination the section marks Recommended. */
export const RECOMMENDED_ROW: { control: RowControl; indicator: RowIndicator } = {
  control: 'on-art',
  indicator: 'bars',
};
