import { Children, isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';

export interface RowShelfProps {
  title: string;
  /** Where the header's "Show all" points; no link when omitted. */
  showAllHref?: string;
  /** One child per tile. Each is wrapped in a fixed-width list item, so a
   *  long name can only wrap inside its own tile, never widen the row. */
  children: ReactNode;
  className?: string;
}

/** The phone tile width: about 2.3 tiles show at 390px, the next one
 *  peeking in from the right edge says the row scrolls. */
export const ROW_TILE_CLASS = 'w-36 shrink-0 snap-start';

/** Presentational only: the phone Home's sideways shelf, Spotify style. A
 *  big one-line title with a quiet "Show all" beside it, then a row of
 *  tiles that scrolls by touch (snapping to a tile, no bar showing) and
 *  runs from screen edge to screen edge while lining up with the page's
 *  gutter at rest. */
export function RowShelf({ title, showAllHref, children, className }: RowShelfProps) {
  const tiles = Children.toArray(children);
  if (tiles.length === 0) return null;
  return (
    <section className={cn('mb-section', className)} aria-label={title}>
      <SectionHeader
        title={title}
        className="mb-row min-w-0"
        titleClassName="min-w-0 truncate text-[22px] leading-7 font-bold tracking-tight"
        action={
          showAllHref ? (
            <Link
              href={showAllHref}
              className="shrink-0 whitespace-nowrap text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Show all
            </Link>
          ) : undefined
        }
      />
      <div
        role="list"
        data-row-shelf
        className="-mx-page flex snap-x snap-mandatory scroll-px-page gap-row overflow-x-auto overscroll-x-contain px-page scrollbar-none"
      >
        {tiles.map((tile, i) => (
          <div key={isValidElement(tile) && tile.key != null ? tile.key : i} role="listitem" className={ROW_TILE_CLASS}>
            {tile}
          </div>
        ))}
      </div>
    </section>
  );
}
