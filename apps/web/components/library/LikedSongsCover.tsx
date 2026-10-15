import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Bars of the heart-as-sound-wave: [x, y1, y2] in a 100x100 box, taken
 *  from the heart outline (so no trig at render). Three densities keep the
 *  bars crisp: fine for big covers, medium for 36-63px, chunky below. */
const BARS = {
  lg: {
    stroke: 3.8,
    glow: 4,
    bars: [[12,22.7,44.5],[17.4,17.8,51.2],[22.9,15.4,56.5],[28.3,14.5,61.1],[33.7,14.8,65.9],[39.1,16.5,70.8],[44.6,20.3,76.7],[50,28.7,85.7],[55.4,20.3,76.7],[60.9,16.5,70.8],[66.3,14.8,65.9],[71.7,14.5,61.1],[77.1,15.4,56.5],[82.6,17.8,51.2],[88,22.7,44.5]],
  },
  md: {
    stroke: 6,
    glow: 6.5,
    bars: [[12,22.7,44.5],[21.5,15.9,55.1],[31,14.5,63.4],[40.5,17.2,72.2],[50,28.7,85.7],[59.5,17.2,72.2],[69,14.5,63.4],[78.5,15.9,55.1],[88,22.7,44.5]],
  },
  sm: {
    stroke: 11,
    glow: 12,
    bars: [[14,20.6,47.2],[32,14.6,64.2],[50,28.7,85.7],[68,14.6,64.2],[86,20.6,47.2]],
  },
} as const;

type Detail = keyof typeof BARS;

export interface LikedSongsCoverProps {
  className?: string;
  /** Bar density. Default 'auto' picks by the box's rendered width (CSS
   *  container query): under 36px chunky, under 64px medium, else fine. */
  size?: 'auto' | Detail;
}

function Bars({ detail, gradId, filterId, className }: { detail: Detail; gradId: string; filterId: string; className?: string }) {
  const { bars, stroke, glow } = BARS[detail];
  return (
    <g data-detail={detail} className={className}>
      <g filter={`url(#${filterId})`} opacity=".55" stroke="#ff7a70" strokeWidth={glow} strokeLinecap="round">
        {bars.map(([x, a, b]) => (
          <line key={x} x1={x} y1={a} x2={x} y2={b} />
        ))}
      </g>
      <g stroke={`url(#${gradId})`} strokeWidth={stroke} strokeLinecap="round">
        {bars.map(([x, a, b]) => (
          <line key={x} x1={x} y1={a} x2={x} y2={b} />
        ))}
      </g>
    </g>
  );
}

const DETAIL_CLASS: Record<Detail, string> = {
  sm: '@min-[36px]:hidden',
  md: 'hidden @min-[36px]:inline @min-[64px]:hidden',
  lg: 'hidden @min-[64px]:inline',
};

/** The Liked songs cover: a heart built from vertical sound-wave bars with a
 *  soft blurred glow copy behind, on the ember wine gradient. Presentational
 *  and decorative (aria-hidden): the surrounding link keeps the name. Fills
 *  its box; the box sets the size and rounding. */
export function LikedSongsCover({ className, size = 'auto' }: LikedSongsCoverProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bgId = `lsc-bg-${uid}`;
  const gradId = `lsc-w-${uid}`;
  const filterId = `lsc-f-${uid}`;
  const details: Detail[] = size === 'auto' ? ['sm', 'md', 'lg'] : [size];
  return (
    <span data-liked-cover className={cn('@container block aspect-square size-full overflow-hidden', className)} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="block size-full">
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f95a55" />
            <stop offset="1" stopColor="#3a0b1c" />
          </linearGradient>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="90">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset=".5" stopColor="#ffe3df" />
            <stop offset="1" stopColor="#ffb3ad" />
          </linearGradient>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>
        <rect width="100" height="100" fill={`url(#${bgId})`} />
        {details.map((d) => (
          <Bars key={d} detail={d} gradId={gradId} filterId={filterId} className={size === 'auto' ? DETAIL_CLASS[d] : undefined} />
        ))}
      </svg>
    </span>
  );
}
