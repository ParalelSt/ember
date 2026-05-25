'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { TrackCard } from './TrackCard';
import type { Track } from '@/types/track';

interface Props {
  title: string;
  tracks: Track[] | undefined;
  loading?: boolean;
}

export function TrackRow({ title, tracks, loading }: Props) {
  const hasTracks = !!tracks && tracks.length > 0;
  if (!loading && !hasTracks) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-bold tracking-tight">{title}</h2>
      {loading && !hasTracks ? (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-[180px] shrink-0 p-3 rounded-xl bg-card">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin snap-x snap-proximity" role="list">
          {tracks!.map((t) => (
            <div key={t.id} role="listitem" className="w-[180px] shrink-0 snap-start">
              <TrackCard track={t} list={tracks!} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
