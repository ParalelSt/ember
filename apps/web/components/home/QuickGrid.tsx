import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { QuickPick } from '@/lib/home';

/** Presentational only: the phone Home's top grid, Spotify style. Two
 *  columns of 56px grey tiles, the cover flush left at the tile's full
 *  height (a playlist's 2x2 mosaic of song covers, Liked songs its heart)
 *  and the name (bold, up to two lines) beside it. A long name wraps and
 *  then ends in an ellipsis inside its own tile. */
export function QuickGrid({ items }: { items: QuickPick[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Your collections" className="mb-section grid grid-cols-2 gap-cluster">
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          <Link
            href={item.href}
            className="flex h-14 items-center overflow-hidden rounded-[6px] bg-secondary transition-colors hover:bg-accent active:bg-accent"
          >
            <CollectionCover
              src={item.src}
              icon={item.icon}
              mosaic={item.mosaic}
              className="size-14 shrink-0 rounded-none shadow-none"
            />
            <span className="min-w-0 flex-1 px-2.5 line-clamp-2 break-words text-[13px] font-bold leading-tight">
              {item.title}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
