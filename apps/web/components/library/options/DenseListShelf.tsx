import type { ReactNode } from 'react';
import Link from 'next/link';
import { CheckIcon } from '@/components/icons';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { CollectionCardProps } from '@/components/library/CollectionCard';

export interface DenseListShelfProps {
  title: string;
  items: CollectionCardProps[];
  size: 'md' | 'lg';
  empty?: ReactNode;
}

/** Option B, "Dense list": rows, not tiles, so a long library of playlists
 *  scans top to bottom instead of wrapping into a grid a phone can only
 *  show three of at a time. Title stays on one line; the subtitle moves to
 *  a right-aligned column instead of wrapping under the title. Same props
 *  shape as CollectionShelf/CollectionCard. */
export function DenseListShelf({ title, items, empty }: DenseListShelfProps) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-3">{title}</h2>
      <div className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 py-2.5 hover:bg-card/60 -mx-2 px-2 rounded-md transition-colors"
          >
            <CollectionCover {...item.cover} className="size-art-xs rounded-md shrink-0" />
            <div className="min-w-0 flex-1 truncate font-medium text-sm">{item.title}</div>
            <div className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground">
              {item.badge === 'downloaded' && <CheckIcon className="h-3.5 w-3.5 text-ember" />}
              <span className="truncate max-w-32 text-right">{item.subtitle}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
