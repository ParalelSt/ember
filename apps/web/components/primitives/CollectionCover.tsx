import { CarIcon, ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
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
}

const ICONS: Record<CoverIcon, typeof HeartIcon> = {
  car: CarIcon,
  heart: HeartIcon,
  clock: ClockIcon,
  upload: UploadIcon,
};

/** Presentational only: no data fetching, no store reads. A collection's
 *  cover is either its artwork, a system icon, or the bare ember gradient. */
export function CollectionCover({ src, icon, className, fallback = 'gradient' }: CollectionCoverProps) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <Artwork
      src={src}
      fallback={fallback === 'card' ? 'none' : 'gradient'}
      className={cn(
        'aspect-square rounded-md shadow-soft',
        fallback === 'card' && 'bg-card',
        className,
      )}
    >
      {Icon ? <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-ember-foreground/90" /> : null}
    </Artwork>
  );
}
