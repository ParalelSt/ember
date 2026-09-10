import type { ReactNode } from 'react';
import { CollectionCard, type CollectionCardProps } from '@/components/library/CollectionCard';

export interface CollectionShelfProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

/** Presentational only: a titled grid of CollectionCards, or `empty` when
 *  there are none. Used for both the "Your collections" and "Playlists"
 *  shelves on /library, and for the offline "Downloaded" shelf. */
export function CollectionShelf({ title, items, size, empty }: CollectionShelfProps) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-3">{title}</h2>
      {items.length === 0 ? (
        empty ?? null
      ) : (
        <div
          className={
            size === 'lg'
              ? 'grid grid-cols-3 gap-3 sm:gap-4 max-w-3xl'
              : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
          }
        >
          {items.map((item) => (
            <CollectionCard key={item.href} {...item} />
          ))}
        </div>
      )}
    </section>
  );
}
