import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface ChartTileProps {
  title: string;
  href: string;
  /** Fixed tile colour (lib/genres/taxonomy CHARTS). */
  color: string;
  /** Text colour on it (lib/genres/taxonomy CHART_INK). */
  ink: string;
  /** Covers from the top of the chart; the first two are drawn. */
  artworkUrls: readonly string[];
  /** Songs in the chart: "Top 50", or fewer when some are gone. */
  count: number;
  variant?: 'phone' | 'desktop';
}

/** Presentational only: one genre chart on Home, a colour tile in its
 *  chart's colour with the genre name top left, a "Top 50" mark bottom
 *  left and the chart's top two covers tilted in the bottom right corner. */
export function ChartTile({ title, href, color, ink, artworkUrls, count, variant = 'phone' }: ChartTileProps) {
  const covers = artworkUrls.slice(0, 2);
  return (
    <Link href={href} aria-label={`${title} chart`} data-chart-tile className="group block min-w-0">
      <div
        className="relative aspect-square overflow-hidden rounded-[8px] transition-transform group-active:scale-[0.98]"
        style={{ backgroundColor: color, color: ink }}
      >
        {covers.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt=""
            loading="lazy"
            className={cn(
              'absolute aspect-square w-[46%] rounded-[4px] object-cover shadow-soft',
              i === 0 ? '-right-[8%] -bottom-[2%] rotate-[22deg]' : 'right-[20%] bottom-[10%] rotate-[8deg] opacity-90',
            )}
          />
        ))}
        <span
          className={cn(
            'absolute top-row right-row left-row line-clamp-3 break-words font-bold leading-tight',
            variant === 'desktop' ? 'text-xl' : 'text-[17px]',
          )}
        >
          {title}
        </span>
        <span className="absolute bottom-row left-row text-[11px] font-bold uppercase tracking-wider">
          {`Top ${Math.min(count, 50)}`}
        </span>
      </div>
    </Link>
  );
}
