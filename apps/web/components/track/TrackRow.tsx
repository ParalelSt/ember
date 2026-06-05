'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TrackCard } from './TrackCard';
import type { Track } from '@/types/track';

interface Props {
  title: string;
  tracks: Track[] | undefined;
  loading?: boolean;
  /** How many cards to show before the "Show all" button is needed. */
  limit?: number;
}

export function TrackRow({ title, tracks, loading, limit = 6 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasTracks = !!tracks && tracks.length > 0;
  if (!loading && !hasTracks) return null;

  const all = tracks ?? [];
  const canExpand = all.length > limit;
  const visible = expanded ? all : all.slice(0, limit);

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

      {loading && !hasTracks ? (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="w-[180px] shrink-0 p-3 rounded-xl bg-card">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : expanded ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          role="list"
        >
          {visible.map((t) => (
            <div key={t.id} role="listitem">
              <TrackCard track={t} list={all} />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin snap-x snap-proximity"
          role="list"
        >
          {visible.map((t) => (
            <div key={t.id} role="listitem" className="w-[180px] shrink-0 snap-start">
              <TrackCard track={t} list={all} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
