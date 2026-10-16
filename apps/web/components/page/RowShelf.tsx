'use client';

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SectionHeader } from '@/components/page/SectionHeader';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { rowEnds, rowStep } from '@/lib/home';
import { useDragScroll } from '@/hooks/useDragScroll';
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

/** The desktop tile: a 180px square cover (the owner's "t180" pick). */
export const WIDE_TILE_CLASS = 'w-[180px] shrink-0';

/** The desktop row: it starts and ends on the content area's edges (the
 *  page gutter), scrolls sideways with no bar showing, and is moved by the
 *  header's arrows, a trackpad or a mouse drag. Every desktop row, whatever
 *  it holds, uses WIDE_TILE_CLASS tiles and this one gap. */
export const WIDE_SCROLL_CLASS = 'flex gap-block overflow-x-auto overscroll-x-contain scrollbar-none';

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
            className="shrink-0 whitespace-nowrap pb-[2px] text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            Show all
          </Link>
        ) : undefined
      }
    />
  );
}

const WIDE_TITLE_CLASS = 'min-w-0 line-clamp-2 break-words text-2xl font-bold tracking-tight';

function ShowAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 whitespace-nowrap text-sm font-bold text-muted-foreground hover:text-foreground hover:underline transition-colors"
    >
      Show all
    </Link>
  );
}

/** Presentational only: a desktop Home row's header. The 24px bold title,
 *  and on the right the row's < and > buttons (when it has a row to move)
 *  then "Show all". */
export function WideRowHeader({ title, showAllHref, arrows }: RowHeaderProps & { arrows?: ReactNode }) {
  return (
    <SectionHeader
      title={title}
      className="mb-row min-w-0 items-center"
      titleClassName={WIDE_TITLE_CLASS}
      action={
        arrows || showAllHref ? (
          <div className="flex shrink-0 items-center gap-cluster">
            {arrows}
            {showAllHref ? <ShowAll href={showAllHref} /> : null}
          </div>
        ) : undefined
      }
    />
  );
}

function ArrowButton({ dir, enabled, onClick }: { dir: -1 | 1; enabled: boolean; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      disabled={!enabled}
      onClick={onClick}
      className={cn(
        'grid size-[30px] place-items-center rounded-full bg-foreground/10 text-foreground transition-[opacity,background-color]',
        'hover:bg-foreground/20 focus-visible:opacity-100',
        // Shown while the row is hovered, always on a touch screen (no
        // hover there), and gone at the end it cannot scroll past.
        'opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
        'disabled:invisible',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** The desktop row: tiles in a sideways scroller whose header arrows move
 *  it by about 80% of its width, each arrow there only while there is
 *  something on its side. */
function WideRowShelf({ title, showAllHref, tiles, className }: { title: string; showAllHref?: string; tiles: ReactNode[]; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ canLeft: false, canRight: false });
  const count = tiles.length;
  // Mouse drag scrolls the row; the click that ends a drag opens nothing.
  useDragScroll(rowRef);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => {
      const next = rowEnds(el.scrollLeft, el.clientWidth, el.scrollWidth);
      setEnds((prev) => (prev.canLeft === next.canLeft && prev.canRight === next.canRight ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [count]);
  const move = (dir: -1 | 1) => {
    const el = rowRef.current;
    if (!el) return;
    const left = dir * rowStep(el.clientWidth);
    if (typeof el.scrollBy === 'function') el.scrollBy({ left, behavior: 'smooth' });
    else el.scrollLeft += left;
  };
  return (
    <section className={cn('group/row mb-section', className)} aria-label={title}>
      <WideRowHeader
        title={title}
        showAllHref={showAllHref}
        arrows={
          <>
            <ArrowButton dir={-1} enabled={ends.canLeft} onClick={() => move(-1)} />
            <ArrowButton dir={1} enabled={ends.canRight} onClick={() => move(1)} />
          </>
        }
      />
      <div ref={rowRef} role="list" data-row-shelf="wide" className={WIDE_SCROLL_CLASS}>
        {tiles.map((tile, i) => (
          <div key={isValidElement(tile) && tile.key != null ? tile.key : i} role="listitem" className={WIDE_TILE_CLASS}>
            {tile}
          </div>
        ))}
      </div>
    </section>
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
  /** 'phone' (default): 140px tiles snapping by touch, edge to edge.
   *  'desktop': 180px tiles inside the gutter, with < and > in the header. */
  variant?: 'phone' | 'desktop';
  /** A phone tile width other than 140px (the mix cards' 172px). */
  phoneTileClassName?: string;
}

/** Presentational only: the phone Home's sideways shelf, Spotify style. A
 *  RowHeader, then a row of tiles that scrolls by touch (snapping to a
 *  tile, no bar showing) and runs from screen edge to screen edge while
 *  lining up with the page's gutter at rest. */
export function RowShelf({ title, showAllHref, limit = ROW_MAX, children, className, variant = 'phone', phoneTileClassName }: RowShelfProps) {
  const all = Children.toArray(children);
  if (all.length === 0) return null;
  const tiles = all.slice(0, limit);
  const more = all.length > tiles.length ? showAllHref : undefined;
  if (variant === 'desktop') return <WideRowShelf title={title} showAllHref={more} tiles={tiles} className={className} />;
  return (
    <section className={cn('mb-section', className)} aria-label={title}>
      <RowHeader title={title} showAllHref={more} />
      <div role="list" data-row-shelf className={ROW_SCROLL_CLASS}>
        {tiles.map((tile, i) => (
          <div key={isValidElement(tile) && tile.key != null ? tile.key : i} role="listitem" className={phoneTileClassName ? cn(ROW_TILE_CLASS, phoneTileClassName) : ROW_TILE_CLASS}>
            {tile}
          </div>
        ))}
      </div>
    </section>
  );
}
