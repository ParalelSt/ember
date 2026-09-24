'use client';

import { useState, useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { columnsForWidth, gridColsClass, visibleCount } from '@/lib/layout';
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
// The columns come from the width the grid itself gets (lib/layout.ts
// columnsForWidth): the window width alone put 5 cards in the ~460px a 768
// tablet leaves beside the sidebar (bughunt V8). Until the grid has been
// measured (server render, tests) the old viewport guess and its matching
// grid-cols classes stand in. Pure layout (it reads sizes, never app state),
// so it can live inside a presentational component.
function useShelfColumns(lyricsOpen: boolean) {
  const variant = lyricsOpen ? 'lyrics' : 'default';
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Same pre-mount guess as before: the largest (lg+) count per variant,
  // since SSR has no window width to measure.
  const [guess, setGuess] = useState(lyricsOpen ? 4 : 6);
  useEffect(() => {
    const update = () => setGuess(visibleCount(variant, window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [variant]);
  // Before paint, so a client-side visit never flashes the guessed count.
  useLayoutEffect(() => {
    if (!grid) return;
    const update = () => setWidth(grid.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [grid]);
  const count = width > 0 ? columnsForWidth(variant, width) : guess;
  const style: CSSProperties | undefined =
    width > 0 ? { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` } : undefined;
  return { gridRef: setGrid, count, style };
}

/** Presentational only: one horizontal shelf of track cards, with an
 *  optional "Show all" link, or the fullscreen grid of every card. */
export function TrackShelf({ title, tracks, loading, showAllHref, renderCard, lyricsOpen = false, fullscreen }: Props) {
  const gridCols = gridColsClass(lyricsOpen ? 'lyrics' : 'default');
  const { gridRef, count: rowCount, style: gridStyle } = useShelfColumns(lyricsOpen);
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
        <div ref={gridRef} className={`grid gap-4 ${gridCols}`} style={gridStyle} role="list">
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

      <div ref={gridRef} className={`grid gap-4 ${gridCols}`} style={gridStyle} role="list">
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
