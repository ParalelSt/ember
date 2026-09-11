'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { gridColsClass, visibleCount } from '@/lib/layout';
import type { Track } from '@/types/track';

interface Props {
  title: string;
  tracks: Track[] | undefined;
  loading?: boolean;
  /** Where "Show all" points. The link only appears when the shelf actually
   *  hides cards, so a short shelf never offers it. */
  showAllHref?: string;
  /** Renders one card. Required rather than defaulting to `TrackCard`
   *  because this shelf is presentational: playback state and the activate
   *  handler come from the caller's hooks, not from here. */
  renderCard: (track: Track, list: Track[]) => ReactNode;
  /** The desktop lyrics panel is open, so `main` is ~max(40vw, 28rem)
   *  narrower and the grid uses fewer columns. Passed in because
   *  presentational components must not read stores. */
  lyricsOpen?: boolean;
  /** When true, the whole content area belongs to this shelf: back link
   *  + big title + responsive grid of every track. */
  fullscreen?: boolean;
}

// When the desktop lyrics panel is open, main shrinks by ~max(40vw, 28rem).
// Use fewer columns so cards stay legible instead of cramming together.
// The grid-cols strings and the one-row visible count both come from
// lib/layout.ts's SHELF_ROW_COUNT now, instead of two hand-kept literals.
// This is a pure viewport hook (it reads window width, never app state), so
// it can live inside a presentational component.
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

/** Presentational only: one horizontal shelf of track cards, with an
 *  optional "Show all" link, or the fullscreen grid of every card. */
export function TrackShelf({ title, tracks, loading, showAllHref, renderCard, lyricsOpen = false, fullscreen }: Props) {
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
        <PageTitle className="mb-6">{title}</PageTitle>
        <div className={`grid gap-4 ${gridCols}`} role="list">
          {all.map((t) => (
            <div key={t.id} role="listitem">
              {renderCard(t, all)}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const canExpand = !!showAllHref && all.length > rowCount;
  const visible = all.slice(0, rowCount);

  return (
    <section className="mb-10">
      <SectionHeader
        title={title}
        className="mb-3"
        action={
          canExpand && showAllHref ? (
            <Link
              href={showAllHref}
              className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Show all ({all.length})
            </Link>
          ) : undefined
        }
      />

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
                {renderCard(t, all)}
              </div>
            ))}
      </div>
    </section>
  );
}
