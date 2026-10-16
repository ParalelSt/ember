import { useId } from 'react';
import { LIKED_GRADIENT } from '@/components/library/libraryIcons';
import { cn } from '@/lib/utils';

/** Phosphor "heart" (fill weight, 256x256), the same shape as HeartIcon. */
const HEART =
  'M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z';

/** The heart fills 66% of the cover, centered: 66 / 256 per unit. */
const HEART_TRANSFORM = 'translate(17 17) scale(0.2578)';

export interface LikedSongsCoverProps {
  className?: string;
}

/** The Liked songs cover (owner's pick, picker liked2): a big solid white
 *  heart with a soft shadow on the violet gradient. Presentational and
 *  decorative (aria-hidden): the surrounding link keeps the name. Fills its
 *  box; the box sets the size and rounding. */
export function LikedSongsCover({ className }: LikedSongsCoverProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bgId = `lsc-bg-${uid}`;
  const shadowId = `lsc-s-${uid}`;
  return (
    <span data-liked-cover className={cn('block aspect-square size-full overflow-hidden', className)} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="block size-full">
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={LIKED_GRADIENT.from} />
            <stop offset="1" stopColor={LIKED_GRADIENT.to} />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.28" />
          </filter>
        </defs>
        <rect width="100" height="100" fill={`url(#${bgId})`} />
        <g filter={`url(#${shadowId})`}>
          <path data-liked-heart d={HEART} transform={HEART_TRANSFORM} fill="#ffffff" />
        </g>
      </svg>
    </span>
  );
}
