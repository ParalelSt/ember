import { Children, isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';

/** How many tiles a phone row holds; past that "Show all" is the way on. */
export const ROW_MAX = 10;

/** The phone tile: a 140px square cover, about 2.3 of them at 390px, the
 *  next one peeking in from the right edge says the row scrolls. */
export const ROW_TILE_CLASS = 'w-[140px] shrink-0 snap-start';

/** The sideways row itself. It runs from screen edge to screen edge
 *  (-mx-page) but its padding (px-page) puts the first tile on the page's
 *  left gutter, the same x as the quick grid and the row titles, and the
 *  matching scroll padding (scroll-px-page) keeps snapping from pulling a
 *  tile out to the screen edge. */
export const ROW_SCROLL_CLASS =
  '-mx-page flex snap-x snap-mandatory scroll-px-page gap-row overflow-x-auto overscroll-x-contain px-page scrollbar-none';

export interface RowHeaderProps {
  title: string;
  /** Where "Show all" points; pass it only when the row holds more than it
   *  shows. */
  showAllHref?: string;
}

/** Presentational only: a phone Home row's header, Spotify style. A big
 *  bold title that wraps to at most two lines inside its own box (it never
 *  pushes "Show all" off or the page wider), and a quiet bold "Show all". */
export function RowHeader({ title, showAllHref }: RowHeaderProps) {
  return (
    <SectionHeader
      title={title}
      className="mb-row min-w-0 items-end"
      titleClassName="min-w-0 line-clamp-2 break-words text-[22px] leading-7 font-bold tracking-tight"
      action={
        showAllHref ? (
          <Link
            href={showAllHref}
            className="shrink-0 whitespace-nowrap pb-0.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            Show all
          </Link>
        ) : undefined
      }
    />
  );
}

export interface RowShelfProps {
  title: string;
  /** Where "Show all" points. It only shows when the row has more tiles
   *  than it holds (`limit`). */
  showAllHref?: string;
  /** How many tiles to show; default ROW_MAX. */
  limit?: number;
  /** One child per tile. Each is wrapped in a fixed-width list item, so a
   *  long name can only wrap inside its own tile, never widen the row. */
  children: ReactNode;
  className?: string;
}

/** Presentational only: the phone Home's sideways shelf, Spotify style. A
 *  RowHeader, then a row of tiles that scrolls by touch (snapping to a
 *  tile, no bar showing) and runs from screen edge to screen edge while
 *  lining up with the page's gutter at rest. */
export function RowShelf({ title, showAllHref, limit = ROW_MAX, children, className }: RowShelfProps) {
  const all = Children.toArray(children);
  if (all.length === 0) return null;
  const tiles = all.slice(0, limit);
  return (
    <section className={cn('mb-section', className)} aria-label={title}>
      <RowHeader title={title} showAllHref={all.length > tiles.length ? showAllHref : undefined} />
      <div role="list" data-row-shelf className={ROW_SCROLL_CLASS}>
        {tiles.map((tile, i) => (
          <div key={isValidElement(tile) && tile.key != null ? tile.key : i} role="listitem" className={ROW_TILE_CLASS}>
            {tile}
          </div>
        ))}
      </div>
    </section>
  );
}
