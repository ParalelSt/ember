'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { TrackCard } from './TrackCard';
import { ChevronLeftIcon } from '@/components/icons';
import { useUiStore } from '@/stores/useUiStore';
import { gridColsClass, visibleCount } from '@/lib/layout';
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

// When the desktop lyrics panel is open, main shrinks by ~max(40vw, 28rem).
// Use fewer columns so cards stay legible instead of cramming together.
// The grid-cols strings and the one-row visible count both come from
// lib/layout.ts's SHELF_ROW_COUNT now, instead of two hand-kept literals.
function useResponsiveRowCount(lyricsOpen: boolean): number {
  const variant = lyricsOpen ? 'lyrics' : 'default';
  // Same pre-mount guess as before: the largest (lg+) count per variant,
  // since SSR has no window width to measure.
  const [count, setCount] = useState(lyricsOpen ? 4 : 6);
  useEffect(() => {
    const update = () => setCount(visibleCount(variant, window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [variant]);
  return count;
}

export function TrackRow({ title, tracks, loading, focusKey, fullscreen }: Props) {
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  const gridCols = gridColsClass(lyricsOpen ? 'lyrics' : 'default');
  const rowCount = useResponsiveRowCount(lyricsOpen);
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
        <div className={`grid gap-4 ${gridCols}`} role="list">
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
        <h2 className="text-section-title">{title}</h2>
        {canExpand && (
          <Link
            href={`/?focus=${encodeURIComponent(focusKey!)}`}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Show all ({all.length})
          </Link>
        )}
      </div>

      <div className={`grid gap-4 ${gridCols}`} role="list">
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
