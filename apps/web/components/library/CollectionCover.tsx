import { ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { cn } from '@/lib/utils';
import type { CollectionIcon } from '@/lib/collections';

export interface CollectionCoverProps {
  src: string | null;
  icon: CollectionIcon | null;
  className?: string;
  /** What shows through with no artwork: the ember gradient every library
   *  collection uses, or the flat card colour of the album/track heroes. */
  fallback?: 'gradient' | 'card';
}

const ICONS: Record<CollectionIcon, typeof HeartIcon> = {
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
      {Icon ? <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-white/90" /> : null}
    </Artwork>
  );
}
