'use client';

import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TrackCard } from './TrackCard';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  tracks: Track[] | undefined;
  loading?: boolean;
}

// One full row at each breakpoint — kept in sync with the grid column count
// below so collapsed view never wraps to a second row.
function useResponsiveRowCount(): number {
  const [count, setCount] = useState(6);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1024) setCount(6);       // lg+
      else if (w >= 768) setCount(5);    // md
      else if (w >= 640) setCount(4);    // sm
      else setCount(3);                  // base (phones)
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return count;
}

export function TrackRow({ title, tracks, loading }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rowCount = useResponsiveRowCount();

  const hasTracks = !!tracks && tracks.length > 0;
  if (!loading && !hasTracks) return null;

  const all = tracks ?? [];
  const canExpand = all.length > rowCount;
  const visible = expanded ? all : all.slice(0, rowCount);

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? 'Show less' : `Show all (${all.length})`}
          </button>
        )}
      </div>

      <div
        className={cn(
          'grid gap-4',
          'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
        )}
        role="list"
      >
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
