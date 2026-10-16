import { CarIcon, MusicIcon } from '@/components/icons';
import { GlyphTile } from '@/components/library/GlyphTile';
import { LIBRARY_BADGES, NEUTRAL_COVER } from '@/components/library/libraryIcons';
import { LikedSongsCover } from '@/components/library/LikedSongsCover';
import { Artwork } from '@/components/primitives/Artwork';
import { cn } from '@/lib/utils';
import type { CollectionIcon } from '@/lib/collections';

/** A collection's icons, plus the car for a live carlist (the phone Home's
 *  quick grid), which is not a library collection. */
export type CoverIcon = CollectionIcon | 'car';

export interface CollectionCoverProps {
  src: string | null;
  icon: CoverIcon | null;
  className?: string;
  /** What shows through with no artwork: the ember gradient every library
   *  collection uses, or the flat card colour of the album/track heroes. */
  fallback?: 'gradient' | 'card';
  /** Four song covers (lib/collections playlistCover): drawn as a 2x2
   *  mosaic in place of `src`. Fewer than four and it is ignored. */
  mosaic?: readonly string[];
}

/** Presentational only: no data fetching, no store reads. A collection's
 *  cover is its artwork, a 2x2 mosaic of song covers, a system collection's
 *  gradient and glyph, or (a playlist with nothing) the neutral music note. */
export function CollectionCover({ src, icon, className, fallback = 'gradient', mosaic }: CollectionCoverProps) {
  const liked = icon === 'heart';
  const system = icon === 'clock' ? LIBRARY_BADGES.recent : icon === 'upload' ? LIBRARY_BADGES.uploads : null;
  const tiles = !icon && mosaic && mosaic.length >= 4 ? mosaic.slice(0, 4) : null;
  // A playlist with nothing to show (no art, fewer than four song covers):
  // the neutral charcoal tile with a soft music note.
  const neutral = !icon && !tiles && !src && fallback === 'gradient';
  return (
    <Artwork
      src={tiles ? null : src}
      fallback={fallback === 'card' || neutral ? 'none' : 'gradient'}
      className={cn(
        'aspect-square rounded-md shadow-soft',
        fallback === 'card' && 'bg-card',
        className,
      )}
    >
      {liked ? <LikedSongsCover className="absolute inset-0" /> : null}
      {system ? <GlyphTile background={system.tile} icon={system.icon} className="absolute inset-0" /> : null}
      {icon === 'car' ? <CarIcon className="absolute inset-0 m-auto h-1/3 w-1/3 text-ember-foreground/90" /> : null}
      {neutral ? (
        <GlyphTile data-neutral-cover background={NEUTRAL_COVER.background} color={NEUTRAL_COVER.color} icon={MusicIcon} className="absolute inset-0" />
      ) : null}
      {tiles ? (
        <div data-mosaic className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          {tiles.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ))}
        </div>
      ) : null}
    </Artwork>
  );
}
