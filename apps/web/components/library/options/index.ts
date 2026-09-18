import { EditorialGridShelf } from '@/components/library/options/EditorialGridShelf';
import { DenseListShelf } from '@/components/library/options/DenseListShelf';
import { FeaturedShelf } from '@/components/library/options/FeaturedShelf';
import { CoverLedShelf } from '@/components/library/options/CoverLedShelf';
import type { CollectionCardProps } from '@/components/library/CollectionCard';
import type { ComponentType, ReactNode } from 'react';

export interface ShelfOptionProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

export interface ShelfOption {
  id: string;
  name: string;
  description: string;
  Component: ComponentType<ShelfOptionProps>;
}

/** The four style options shown on /dizajn, in the order the picker lists
 *  them. `id` is what persists to localStorage. */
export const SHELF_OPTIONS: ShelfOption[] = [
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'The biggest art on the page; a play button appears over a tile on hover.',
    Component: EditorialGridShelf,
  },
  {
    id: 'dense-list',
    name: 'Dense list',
    description: 'Rows with small art and a right-aligned meta column, built to scan a long library.',
    Component: DenseListShelf,
  },
  {
    id: 'featured',
    name: 'Featured mix',
    description: 'The first playlist gets a large tile with its title over the art; the rest sit in a small grid beside it.',
    Component: FeaturedShelf,
  },
  {
    id: 'cover-led',
    name: 'Cover-led',
    description: 'No card background: the art fills the tile edge to edge, title captioned over a bottom scrim.',
    Component: CoverLedShelf,
  },
];

export interface PickerOption {
  id: string;
  name: string;
  description: string;
}

/** Stage 1, "Rhythm" picker (docs/design-system.md section 3): the gap
 *  above and below the action bar. `RhythmPreview` reads these ids
 *  directly, so `id` is also what persists to localStorage. */
export const RHYTHM_OPTIONS: PickerOption[] = [
  {
    id: 'even',
    name: 'Even',
    description: 'Stack (24) above the action bar and stack (24) below it.',
  },
  {
    id: 'grouped',
    name: 'Grouped',
    description: 'Block (16) above the action bar, 32 below it: the actions read as part of the header.',
  },
  {
    id: 'today',
    name: 'Today',
    description: 'The current live spacing, for reference: 0 above the buttons, 48 below them.',
  },
];

/** Stage 1, "Actions" picker: where the action bar sits relative to the
 *  header. */
export const ACTIONS_OPTIONS: PickerOption[] = [
  {
    id: 'beside',
    name: 'Beside',
    description: "Inside the header's text column, bottom edge on the cover's bottom edge (today, minus the ActionBar margin).",
  },
  {
    id: 'below',
    name: 'Below',
    description: "A full-width row under the whole header, aligned to the content's left edge (the album page today).",
  },
];
