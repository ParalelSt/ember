'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { TrackCard } from './TrackCard';
import { ChevronLeftIcon } from '@/components/icons';
import type { Track } from '@/types/track';

interface Props {
  title: string;
  tracks: Track[] | undefined;
  loading?: boolean;
  /** Key used to drive the `?focus=<key>` URL when the user clicks
   *  "Show all" — also tells the row when it's the one being focused. */
  focusKey?: string;
  /** When true, the whole content area belongs to this row — back link
   *  + big title + responsive grid of every track. */
  fullscreen?: boolean;
}

const GRID_COLS = 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6';

// One full row at each breakpoint — keep in sync with GRID_COLS above so the
// collapsed view never wraps to a second row.
function useResponsiveRowCount(): number {
  const [count, setCount] = useState(6);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1024) setCount(6);
      else if (w >= 768) setCount(5);
      else if (w >= 640) setCount(4);
      else setCount(3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return count;
}

export function TrackRow({ title, tracks, loading, focusKey, fullscreen }: Props) {
  const rowCount = useResponsiveRowCount();
  const hasTracks = !!tracks && tracks.length > 0;
  if (!loading && !hasTracks) return null;

  const all = tracks ?? [];

  if (fullscreen) {
    return (
      <section>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeftIcon className="size-4" />
          Back
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">{title}</h1>
        <div className={`grid gap-4 ${GRID_COLS}`} role="list">
          {all.map((t) => (
            <div key={t.id} role="listitem">
              <TrackCard track={t} list={all} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const canExpand = !!focusKey && all.length > rowCount;
  const visible = all.slice(0, rowCount);

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {canExpand && (
          <Link
            href={`/?focus=${encodeURIComponent(focusKey!)}`}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Show all ({all.length})
          </Link>
        )}
      </div>

      <div className={`grid gap-4 ${GRID_COLS}`} role="list">
        {loading && !hasTracks
          ? Array.from({ length: rowCount }).map((_, i) => (
              <div key={i} className="p-3 rounded-xl bg-card">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            ))
          : visible.map((t) => (
              <div key={t.id} role="listitem">
                <TrackCard track={t} list={all} />
              </div>
            ))}
      </div>
    </section>
  );
}
