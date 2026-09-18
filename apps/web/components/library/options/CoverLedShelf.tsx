import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckIcon } from '@/components/icons';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { CollectionCardProps } from '@/components/library/CollectionCard';

export interface CoverLedShelfProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

/** Option D, "Cover-led": no card background, no padding around the art;
 *  the tile is the artwork, full bleed, with the title captioned over the
 *  bottom on a scrim. A playlist with no art gets the ember gradient at
 *  full size instead of shrinking into a corner icon, which is closer to
 *  how the search overlay and album pages already treat missing art. */
export function CoverLedShelf({ title, items, empty }: CoverLedShelfProps) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-4">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group relative block aspect-square rounded-lg overflow-hidden"
          >
            <CollectionCover {...item.cover} className="h-full w-full rounded-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-2.5">
              <div className="flex items-center gap-1">
                {item.badge === 'downloaded' && (
                  <CheckIcon className="h-3 w-3 text-ember shrink-0" />
                )}
                <div className="truncate font-medium text-xs text-white">{item.title}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
