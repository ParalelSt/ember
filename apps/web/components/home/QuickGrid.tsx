import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { QuickPick } from '@/lib/home';

/** Presentational only: the phone Home's top grid, Spotify style. Two
 *  columns of compact tiles, the cover filling the tile's height on the
 *  left and the name (bold, up to two lines) beside it. A long name wraps
 *  and then ends in an ellipsis inside its own tile. */
export function QuickGrid({ items }: { items: QuickPick[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Your collections" className="mb-section grid grid-cols-2 gap-cluster">
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          <Link
            href={item.href}
            className="flex h-14 items-center gap-cluster overflow-hidden rounded-sm bg-popover pr-cluster transition-colors hover:bg-accent active:bg-accent"
          >
            <CollectionCover
              src={item.src}
              icon={item.icon}
              className="size-14 shrink-0 rounded-none shadow-none"
            />
            <span className="min-w-0 line-clamp-2 break-words text-[13px] font-bold leading-tight">
              {item.title}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
