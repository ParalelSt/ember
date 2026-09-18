import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckIcon } from '@/components/icons';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { CollectionCardProps } from '@/components/library/CollectionCard';
import { cn } from '@/lib/utils';

export interface FeaturedShelfProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

/** Option C, "Featured mix": the first item in the list (today: whatever
 *  order the API returns, most-recently-touched first) gets a large tile
 *  with the title set over the art; everything else sits in a small grid
 *  next to it. An honest use of the one piece of order the data already
 *  has, not a random hero. */
export function FeaturedShelf({ title, items, empty }: FeaturedShelfProps) {
  if (items.length === 0) return <>{empty ?? null}</>;
  const [featured, ...rest] = items;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-4">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <Link href={featured.href} className="group relative block rounded-2xl overflow-hidden">
          <CollectionCover
            {...featured.cover}
            className="aspect-square sm:aspect-auto sm:h-full rounded-none transition-transform duration-150 group-hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center gap-1.5">
              {featured.badge === 'downloaded' && (
                <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />
              )}
              <div className="truncate font-semibold text-lg text-white">{featured.title}</div>
            </div>
            <div className="mt-0.5 text-xs text-white/70 truncate">{featured.subtitle}</div>
          </div>
        </Link>
        <div className="grid grid-cols-2 gap-3 content-start">
          {rest.map((item) => (
            <Link key={item.href} href={item.href} className="group block">
              <CollectionCover
                {...item.cover}
                className="aspect-square rounded-lg shadow-soft transition-transform duration-150 group-hover:scale-[1.02]"
              />
              <div className={cn('mt-2 flex items-center gap-1.5')}>
                {item.badge === 'downloaded' && (
                  <CheckIcon className="h-3 w-3 text-ember shrink-0" />
                )}
                <div className="truncate font-medium text-xs">{item.title}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
