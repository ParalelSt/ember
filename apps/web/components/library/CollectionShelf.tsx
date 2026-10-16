import type { ReactNode } from 'react';
import { CollectionCard, type CollectionCardProps } from '@/components/library/CollectionCard';

export interface CollectionShelfProps {
  title: string;
  items: CollectionCardProps[];
  empty?: ReactNode;
}

/** Presentational only: a titled grid of unboxed CollectionCards, or `empty` when
 *  there are none. Used for both the "Your collections" and "Playlists"
 *  shelves on /library, and for the offline "Downloaded" shelf. */
export function CollectionShelf({ title, items, empty }: CollectionShelfProps) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-3">{title}</h2>
      {items.length === 0 ? (
        empty ?? null
      ) : (
        // The standard density: 3 across on a phone, 6 on desktop.
        <div data-library-grid className="grid grid-cols-3 gap-row md:grid-cols-6 md:gap-block">
          {items.map((item) => (
            <CollectionCard key={item.href} {...item} />
          ))}
        </div>
      )}
    </section>
  );
}
