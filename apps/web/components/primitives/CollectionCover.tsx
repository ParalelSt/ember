import { CarIcon, ClockIcon, UploadIcon } from '@/components/icons';
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

const ICONS: Record<Exclude<CoverIcon, 'heart'>, typeof CarIcon> = {
  car: CarIcon,
  clock: ClockIcon,
  upload: UploadIcon,
};

/** Presentational only: no data fetching, no store reads. A collection's
 *  cover is either its artwork, a system icon, or the bare ember gradient. */
export function CollectionCover({ src, icon, className, fallback = 'gradient', mosaic }: CollectionCoverProps) {
  const Icon = icon && icon !== 'heart' ? ICONS[icon] : null;
  const liked = icon === 'heart';
  const tiles = !icon && mosaic && mosaic.length >= 4 ? mosaic.slice(0, 4) : null;
  return (
    <Artwork
      src={tiles ? null : src}
      fallback={fallback === 'card' ? 'none' : 'gradient'}
      className={cn(
        'aspect-square rounded-md shadow-soft',
        fallback === 'card' && 'bg-card',
        className,
      )}
    >
      {liked ? <LikedSongsCover className="absolute inset-0" /> : null}
      {Icon ? <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-ember-foreground/90" /> : null}
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
