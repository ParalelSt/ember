'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { PlayButton } from '@/components/primitives/PlayButton';
import type { QuickPick } from '@/lib/home';
import { cn } from '@/lib/utils';

export type QuickGridLayout = 'today' | 'fixed-280' | 'fixed-320' | 'fixed-360' | 'auto-220' | 'auto-260' | 'auto-300' | 'capped' | 'six-columns' | 'two-rows';
export interface QuickGridProps {
  /** Optional desktop experiments. Defaults preserve Home. */
  layout?: QuickGridLayout;
  tileHeight?: 48 | 56 | 64 | 72 | 80;
  tileStyle?: 'flush' | 'inset' | 'covers' | 'pill';
  showSongCount?: boolean;
  items: QuickPick[];
  /** 'phone' (default): two columns of 56px tiles. 'desktop': four columns
   *  of 64px tiles, each with a play button on hover. */
  variant?: 'phone' | 'desktop';
  /** Desktop: play (or pause) the tile's collection. Tiles without a
   *  collection (a live carlist) have no button. */
  onPlay?: (item: QuickPick) => void;
  /** Desktop: the tile's collection is the one playing now. */
  isPlaying?: (item: QuickPick) => boolean;
}

/** Presentational only: the desktop Home's top grid (the owner's "chips4"
 *  pick). Four columns of 64px tiles on a faint white wash that lightens on
 *  hover, the cover flush left, the name bold over up to two lines, and an
 *  ember play button that appears at the tile's right on hover (and stays
 *  while that collection plays). The button is beside the link, not in it. */
const HEIGHT = { 48: 'h-12', 56: 'h-14', 64: 'h-16', 72: 'h-18', 80: 'h-20' };
const COVER = { 48: 'size-12', 56: 'size-14', 64: 'size-16', 72: 'size-18', 80: 'size-20' };
const INSET = { 48: 'size-9', 56: 'size-11', 64: 'size-[52px]', 72: 'size-15', 80: 'size-17' };
const TOP = { 48: 'top-1', 56: 'top-2', 64: 'top-row', 72: 'top-4', 80: 'top-5' };

function DesktopQuickGrid({ items, onPlay, isPlaying, layout = 'today', tileHeight = 64, tileStyle = 'flush', showSongCount = false }: Omit<QuickGridProps, 'variant'>) {
  const grid = useRef<HTMLUListElement>(null);
  const [columns, setColumns] = useState(4);
  const [expanded, setExpanded] = useState(false);
  const covers = tileStyle === 'covers';
  const height = tileStyle === 'pill' ? 48 : tileHeight;
  const min = layout === 'auto-220' ? 220 : layout === 'auto-300' ? 300 : 260;
  const template = covers ? 'repeat(auto-fill, 120px)'
    : layout.startsWith('fixed-') ? `repeat(auto-fill, ${layout.slice(6)}px)`
    : layout === 'six-columns' ? 'repeat(auto-fill, minmax(max(200px, calc((100% - 5 * var(--spacing-row)) / 6)), 1fr))'
    : layout.startsWith('auto-') || layout === 'two-rows' ? `repeat(auto-fill, minmax(${min}px, 1fr))`
    : undefined;

  useEffect(() => {
    if (layout !== 'two-rows' || !grid.current) return;
    const el = grid.current;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
      setColumns(Math.max(1, Math.floor((el.getBoundingClientRect().width + gap) / (260 + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);
  const limited = layout === 'two-rows' && items.length > columns * 2;
  const visible = limited && !expanded ? items.slice(0, columns * 2) : items;

  return (
    <>
      <ul ref={grid} aria-label="Your collections" data-quick-grid="desktop"
        style={template ? { gridTemplateColumns: template } : undefined}
        className={cn('mb-section grid gap-row', !template && 'grid-cols-4', layout === 'capped' && 'max-w-[1200px]')}>
        {visible.map((item) => {
          const playing = isPlaying?.(item) ?? false;
          return (
            <li key={item.key} className="group relative min-w-0">
              <Link href={item.href} className={cn(
                'flex items-center overflow-hidden rounded-[6px] bg-foreground/10 transition-colors group-hover:bg-foreground/20',
                covers ? 'w-[120px] flex-col' : HEIGHT[height],
                tileStyle === 'inset' && 'p-[6px]', tileStyle === 'pill' && 'rounded-full',
              )}>
                <CollectionCover src={item.src} icon={item.icon} mosaic={item.mosaic} className={cn(
                  'shrink-0 rounded-none shadow-none',
                  covers ? 'size-[120px]' : tileStyle === 'inset' ? INSET[height] : COVER[height],
                  tileStyle === 'inset' && 'rounded-md',
                )} />
                <span className={cn('min-w-0 flex-1 px-row line-clamp-2 break-words text-sm font-bold leading-tight', covers && 'w-full py-row', showSongCount && 'line-clamp-none')}>
                  {showSongCount ? <><span className="line-clamp-2">{item.title}</span>{item.songCount && <span className="mt-inset block text-xs font-normal text-muted-foreground">{item.songCount}</span>}</> : item.title}
                </span>
              </Link>
              {item.ref && onPlay && (
                <PlayButton size="sm" label={playing ? 'Pause' : `Play ${item.title}`} playing={playing} onClick={() => onPlay(item)}
                  className={cn('absolute right-[10px] shadow-soft transition-opacity', covers ? 'top-[70px]' : TOP[height],
                    playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')} />
              )}
            </li>
          );
        })}
      </ul>
      {limited && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mb-stack rounded-full bg-secondary px-block py-cluster text-sm font-semibold hover:bg-accent">{expanded ? 'Show less' : 'Show all'}</button>}
    </>
  );
}

/** Presentational only: the phone Home's top grid, Spotify style. Two
 *  columns of 56px grey tiles, the cover flush left at the tile's full
 *  height (a playlist's 2x2 mosaic of song covers, Liked songs its heart)
 *  and the name (bold, up to two lines) beside it. A long name wraps and
 *  then ends in an ellipsis inside its own tile. */
export function QuickGrid({ items, variant = 'phone', onPlay, isPlaying, ...desktopProps }: QuickGridProps) {
  if (items.length === 0) return null;
  if (variant === 'desktop') return <DesktopQuickGrid items={items} onPlay={onPlay} isPlaying={isPlaying} {...desktopProps} />;
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
            <span className="min-w-0 flex-1 px-[10px] line-clamp-2 break-words text-[13px] font-bold leading-tight">
              {item.title}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
