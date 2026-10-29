'use client';

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SectionHeader } from '@/components/page/SectionHeader';
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
 *  page gutter), scrolls sideways with no bar showing, and is moved by a
 *  trackpad, Shift+wheel, a mouse drag or its edge fades. Every desktop row, whatever
 *  it holds, uses WIDE_TILE_CLASS tiles and this one gap. */
export const WIDE_SCROLL_CLASS = 'flex gap-block overflow-x-auto overscroll-x-contain scrollbar-none';

export interface RowHeaderProps {
  title: string;
  /** Where "Show all" points; pass it only when the row holds more than it
   *  shows. */
  showAllHref?: string;
  /** Something of the row's own beside the title (Radio's "Use my
   *  location"), before "Show all". */
  action?: ReactNode;
}

/** Presentational only: a phone Home row's header, Spotify style. A big
 *  bold title that wraps to at most two lines inside its own box (it never
 *  pushes "Show all" off or the page wider), and a quiet bold "Show all". */
export function RowHeader({ title, showAllHref, action }: RowHeaderProps) {
  const showAll = showAllHref ? (
    <Link
      href={showAllHref}
      className="shrink-0 whitespace-nowrap pb-[2px] text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
    >
      Show all
    </Link>
  ) : null;
  return (
    <SectionHeader
      title={title}
      className="mb-row min-w-0 items-end"
      titleClassName="min-w-0 line-clamp-2 break-words text-[22px] leading-7 font-bold tracking-tight"
      action={
        action ? (
          <div className="flex shrink-0 items-center gap-cluster">
            {action}
            {showAll}
          </div>
        ) : showAll ?? undefined
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
export function WideRowHeader({ title, showAllHref, arrows, action }: RowHeaderProps & { arrows?: ReactNode }) {
  return (
    <SectionHeader
      title={title}
      className="mb-row min-w-0 items-center"
      titleClassName={WIDE_TITLE_CLASS}
      action={
        arrows || action || showAllHref ? (
          <div className="flex shrink-0 items-center gap-cluster">
            {action}
            {arrows}
            {showAllHref ? <ShowAll href={showAllHref} /> : null}
          </div>
        ) : undefined
      }
    />
  );
}

/** A soft fade over one end of a desktop row, there only while more
 *  tiles wait on that side (the owner's "wheel" pick, homedesk2: no arrow
 *  buttons). Clicking it slides the row one step. */
function FadeEdge({ dir, enabled, onClick }: { dir: -1 | 1; enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      disabled={!enabled}
      onClick={onClick}
      data-row-fade={dir < 0 ? 'left' : 'right'}
      className={cn(
        'absolute inset-y-0 z-10 w-16 from-background to-transparent transition-opacity disabled:invisible disabled:opacity-0',
        dir < 0 ? 'left-0 bg-linear-to-r' : 'right-0 bg-linear-to-l',
      )}
    />
  );
}

/** The desktop row: tiles in a sideways scroller with no buttons. A plain
 *  mouse wheel over the row scrolls the page, never the row (turning it
 *  sideways made the home page hard to scroll); a sideways swipe (trackpad,
 *  tilt wheel, Shift+wheel) or a mouse drag moves the row, and a soft fade marks each
 *  side that has more; clicking a fade moves the row by about 80% of its
 *  width. */
function WideRowShelf({ title, showAllHref, action, tiles, className }: { title: string; showAllHref?: string; action?: ReactNode; tiles: ReactNode[]; className?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ canLeft: false, canRight: false });
  const count = tiles.length;
  // Mouse drag scrolls the row; the click that ends a drag opens nothing.
  useDragScroll(rowRef);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // A sideways swipe (trackpad, tilt wheel, Shift+wheel) moves the row
    // while it can go that way. Done here rather than left to the browser so
    // it works the same everywhere and a swipe at the row's end never turns
    // into the browser's back/forward gesture. Up and down is the page's.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaX > 0 && el.scrollLeft < max - 1) || (e.deltaX < 0 && el.scrollLeft > 1)) {
        e.preventDefault();
        el.scrollLeft += e.deltaX;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
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
    <section className={cn('mb-section', className)} aria-label={title}>
      <WideRowHeader title={title} showAllHref={showAllHref} action={action} />
      <div className="relative">
        <div ref={rowRef} role="list" data-row-shelf="wide" className={WIDE_SCROLL_CLASS}>
          {tiles.map((tile, i) => (
            <div key={isValidElement(tile) && tile.key != null ? tile.key : i} role="listitem" className={WIDE_TILE_CLASS}>
              {tile}
            </div>
          ))}
        </div>
        <FadeEdge dir={-1} enabled={ends.canLeft} onClick={() => move(-1)} />
        <FadeEdge dir={1} enabled={ends.canRight} onClick={() => move(1)} />
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
  /** Something of the row's own in its header, beside the title. */
  action?: ReactNode;
}

/** Presentational only: the phone Home's sideways shelf, Spotify style. A
 *  RowHeader, then a row of tiles that scrolls by touch (snapping to a
 *  tile, no bar showing) and runs from screen edge to screen edge while
 *  lining up with the page's gutter at rest. */
export function RowShelf({ title, showAllHref, limit = ROW_MAX, children, className, variant = 'phone', phoneTileClassName, action }: RowShelfProps) {
  const all = Children.toArray(children);
  if (all.length === 0) return null;
  const tiles = all.slice(0, limit);
  const more = all.length > tiles.length ? showAllHref : undefined;
  if (variant === 'desktop') return <WideRowShelf title={title} showAllHref={more} action={action} tiles={tiles} className={className} />;
  return (
    <section className={cn('mb-section', className)} aria-label={title}>
      <RowHeader title={title} showAllHref={more} action={action} />
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
