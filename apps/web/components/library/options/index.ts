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

/** One choice in a /dizajn pill picker; `id` is what persists to
 *  localStorage. */
export interface PickerOption {
  id: string;
  name: string;
  description: string;
}
