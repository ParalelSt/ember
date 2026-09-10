import { ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { cn } from '@/lib/utils';
import type { CollectionIcon } from '@/lib/collections';

export interface CollectionCoverProps {
  src: string | null;
  icon: CollectionIcon | null;
  className?: string;
}

const ICONS: Record<CollectionIcon, typeof HeartIcon> = {
  heart: HeartIcon,
  clock: ClockIcon,
  upload: UploadIcon,
};

/** Presentational only: no data fetching, no store reads. A collection's
 *  cover is either its artwork, a system icon, or the bare ember gradient. */
export function CollectionCover({ src, icon, className }: CollectionCoverProps) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <Artwork
      src={src}
      fallback="gradient"
      className={cn('aspect-square rounded-md shadow-soft', className)}
    >
      {Icon ? <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-white/90" /> : null}
    </Artwork>
  );
}
