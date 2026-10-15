import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { PlayButton } from '@/components/primitives/PlayButton';
import type { QuickPick } from '@/lib/home';
import { cn } from '@/lib/utils';

export interface QuickGridProps {
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
function DesktopQuickGrid({ items, onPlay, isPlaying }: Omit<QuickGridProps, 'variant'>) {
  return (
    <ul aria-label="Your collections" data-quick-grid="desktop" className="mb-section grid grid-cols-4 gap-row">
      {items.map((item) => {
        const playing = isPlaying?.(item) ?? false;
        return (
          <li key={item.key} className="group relative min-w-0">
            <Link
              href={item.href}
              className="flex h-16 items-center overflow-hidden rounded-[6px] bg-foreground/10 transition-colors group-hover:bg-foreground/20"
            >
              <CollectionCover
                src={item.src}
                icon={item.icon}
                mosaic={item.mosaic}
                className="size-16 shrink-0 rounded-none shadow-none"
              />
              <span className="min-w-0 flex-1 px-row line-clamp-2 break-words text-sm font-bold leading-tight">
                {item.title}
              </span>
            </Link>
            {item.ref && onPlay && (
              <PlayButton
                size="sm"
                label={playing ? 'Pause' : `Play ${item.title}`}
                playing={playing}
                onClick={() => onPlay(item)}
                className={cn(
                  // Centred by a fixed top, (64 - 40) / 2, not a translate:
                  // the button's own press nudge is a translate and would
                  // make it jump out from under the pointer.
                  'absolute top-row right-[10px] shadow-soft transition-opacity',
                  playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Presentational only: the phone Home's top grid, Spotify style. Two
 *  columns of 56px grey tiles, the cover flush left at the tile's full
 *  height (a playlist's 2x2 mosaic of song covers, Liked songs its heart)
 *  and the name (bold, up to two lines) beside it. A long name wraps and
 *  then ends in an ellipsis inside its own tile. */
export function QuickGrid({ items, variant = 'phone', onPlay, isPlaying }: QuickGridProps) {
  if (items.length === 0) return null;
  if (variant === 'desktop') return <DesktopQuickGrid items={items} onPlay={onPlay} isPlaying={isPlaying} />;
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
