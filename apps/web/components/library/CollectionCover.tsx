import { ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
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
    <div
      className={cn(
        'relative aspect-square overflow-hidden rounded-md shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)]',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : Icon ? (
        <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-white/90" />
      ) : null}
    </div>
  );
}
