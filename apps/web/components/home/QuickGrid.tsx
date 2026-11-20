'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { PlayButton } from '@/components/primitives/PlayButton';
import type { QuickPick } from '@/lib/home';
import { cn } from '@/lib/utils';
import { quickGridSlots, type QuickGridVariant } from '@/lib/quickGrid';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { MoreIcon } from '@/components/icons';

export type QuickGridLayout = 'today' | 'fixed-280' | 'fixed-320' | 'fixed-360' | 'auto-220' | 'auto-260' | 'auto-300' | 'capped' | 'six-columns' | 'two-rows';
export interface QuickGridProps {
  /** Optional desktop experiments. Defaults preserve Home. */
  layout?: QuickGridLayout;
  tileHeight?: 48 | 56 | 64 | 72 | 80;
  tileStyle?: 'flush' | 'inset' | 'covers' | 'pill';
  showSongCount?: boolean;
  items: QuickPick[];
  /** Design preview (lib/quickGrid.ts): one row plus a menu of every
   *  collection. Absent or 'today' = the grid as shipped. */
  design?: QuickGridVariant;
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
export function QuickGrid({ items, variant = 'phone', onPlay, isPlaying, design = 'today', ...desktopProps }: QuickGridProps) {
  if (items.length === 0) return null;
  if (design !== 'today') return <OneRowQuickGrid items={items} design={design} variant={variant} onPlay={onPlay} isPlaying={isPlaying} />;
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

const MIN_TILE = 260;
const SQUARE = 56;

function Tile({ item, desktop, onPlay, isPlaying }: { item: QuickPick; desktop: boolean; onPlay?: (item: QuickPick) => void; isPlaying?: (item: QuickPick) => boolean }) {
  const playing = isPlaying?.(item) ?? false;
  return (
    <li className="group relative min-w-0">
      <Link href={item.href} className={cn(
        'flex items-center overflow-hidden rounded-[6px] transition-colors',
        desktop ? 'h-16 bg-foreground/10 group-hover:bg-foreground/20' : 'h-14 bg-secondary hover:bg-accent active:bg-accent',
      )}>
        <CollectionCover src={item.src} icon={item.icon} mosaic={item.mosaic}
          className={cn('shrink-0 rounded-none shadow-none', desktop ? 'size-16' : 'size-14')} />
        <span className={cn('min-w-0 flex-1 line-clamp-2 break-words font-bold leading-tight', desktop ? 'px-row text-sm' : 'px-[10px] text-[13px]')}>{item.title}</span>
      </Link>
      {desktop && item.ref && onPlay && (
        <PlayButton size="sm" label={playing ? 'Pause' : `Play ${item.title}`} playing={playing} onClick={() => onPlay(item)}
          className={cn('absolute right-[10px] top-row shadow-soft transition-opacity', playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')} />
      )}
    </li>
  );
}

/** Every collection, in a bottom sheet (phone) or a popover under its button
 *  (desktop). A link closes it; Escape and a click outside close it. */
function CollectionsMenu({ items, desktop, open, onClose, align }: { items: QuickPick[]; desktop: boolean; open: boolean; onClose: () => void; align: 'left' | 'right' }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!desktop || !open) return;
    const root = box.current;
    root?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      root?.parentElement?.querySelector<HTMLElement>('[data-quick-grid-more]')?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!root?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [desktop, open, onClose]);

  const list = (
    <ul aria-label="All collections" className="flex flex-col">
      {items.map((item) => (
        <li key={item.key}>
          <Link href={item.href} onClick={onClose} className="flex items-center gap-row rounded-md p-1 hover:bg-accent focus-visible:bg-accent">
            <CollectionCover src={item.src} icon={item.icon} mosaic={item.mosaic} className="size-12 shrink-0 rounded-[6px] shadow-none" />
            <span className="min-w-0 flex-1 line-clamp-2 break-words text-[13px] font-bold leading-tight">{item.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[80dvh] gap-cluster p-4">
          <SheetTitle>All collections</SheetTitle>
          {list}
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <div ref={box} role="dialog" aria-label="All collections"
      className={cn('absolute top-full z-50 mt-2 max-h-[60vh] w-80 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10', align === 'right' ? 'right-0' : 'left-0')}>
      {list}
    </div>
  );
}

function OneRowQuickGrid({ items, design, variant, onPlay, isPlaying }: Pick<QuickGridProps, 'items' | 'variant' | 'onPlay' | 'isPlaying'> & { design: Exclude<QuickGridVariant, 'today'> }) {
  const desktop = variant === 'desktop';
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!desktop || !wrap.current) return;
    const el = wrap.current;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [desktop]);

  const gap = 12;
  const fits = (w: number) => Math.max(1, Math.floor((w + gap) / (MIN_TILE + gap)));
  const fit = desktop ? fits(width) : 2;
  const slots = quickGridSlots(items.length, fit, design);
  const { overflow } = slots;
  let visible = slots.visible;
  // Variant b: the square takes a slot's width, so count what fits beside it.
  if (desktop && design === 'b' && overflow) visible = fits(width - SQUARE - gap);
  const shown = items.slice(0, visible);

  const columns = `repeat(${visible}, minmax(0, 1fr))${design === 'b' && overflow ? ` ${SQUARE}px` : ''}`;
  const align = design === 'a' ? 'left' : 'right';
  const trigger = (cls: string, label: string, content: React.ReactNode) => (
    <button type="button" data-quick-grid-more aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen((o) => !o)} className={cls}>{content}</button>
  );

  return (
    <div ref={wrap} data-quick-grid={desktop ? 'desktop' : 'phone'} data-quick-grid-design={design} className="relative mb-section">
      {design === 'c' && overflow && (
        <div className="relative mb-cluster flex items-center justify-between">
          <h2 className="text-sm font-bold">Your collections</h2>
          {trigger('rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground hover:text-foreground', 'See all', 'See all')}
          <CollectionsMenu items={items} desktop={desktop} open={open} onClose={close} align={align} />
        </div>
      )}
      <ul aria-label="Your collections" style={{ gridTemplateColumns: columns }} className="grid gap-cluster md:gap-row">
        {shown.map((item) => <Tile key={item.key} item={item} desktop={desktop} onPlay={onPlay} isPlaying={isPlaying} />)}
        {design === 'b' && overflow && (
          <li className="relative min-w-0">
            {trigger(cn('flex w-full items-center justify-center rounded-[6px] bg-secondary hover:bg-accent', desktop ? 'h-16 bg-foreground/10' : 'h-14'), 'All collections', <MoreIcon size={22} />)}
            <CollectionsMenu items={items} desktop={desktop} open={open} onClose={close} align={align} />
          </li>
        )}
      </ul>
      {design === 'a' && overflow && (
        <div className="relative mt-cluster">
          {trigger('rounded-full bg-secondary px-block py-cluster text-sm font-semibold hover:bg-accent', `All collections (${items.length})`, `All collections (${items.length})`)}
          <CollectionsMenu items={items} desktop={desktop} open={open} onClose={close} align={align} />
        </div>
      )}
    </div>
  );
}
