'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { TrackRow } from '@/components/track/TrackRow';
import type { TrackActions } from '@/components/track/TrackList';
import { Artwork } from '@/components/primitives/Artwork';
import { EmptyState } from '@/components/page/EmptyState';
import { ArtistIcon, ChevronRightIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { songKey } from '@/lib/songKey';
import { songPageHref } from '@/lib/songPage';
import type { SearchArtist } from '@/lib/search/types';
import type { SearchView } from '@/lib/search/view';
import type { PlaybackContext, Track } from '@/types/track';

/** Each row starts fading in this long after the row above it. */
export const STAGGER_MS = 40;
/** Rows further down than this in one arrival all start with the last
 *  one: they are below the fold anyway, and a 30-row answer should not
 *  take a second and a half to finish appearing. */
export const MAX_STAGGER_ROWS = 12;

/** How a row reaches the song's own page.
 *  - `desktop`: the cover and the title both open it; the play button plays.
 *  - `phone`: only the cover opens it; the title still plays, and scrolls
 *    on one line when it does not fit. */
export type SearchResultsPlatform = 'desktop' | 'phone';

export interface SearchResultsProps extends TrackActions {
  view: SearchView;
  platform: SearchResultsPlatform;
  /** Where these results live: drives radio behavior after the queue ends. */
  context?: PlaybackContext | null;
  /** Per-row menu (pages pass `renderTrackMenu`). */
  trailing?: (track: Track) => ReactNode;
  /** TrackRow's search shape: play/pause at the trailing end. */
  trailingPlayControl?: boolean;
}

/** One arriving row. Its delay is fixed when it first appears, so a later
 *  arrival (which shifts where the next batch starts counting) never
 *  restarts or rewinds a fade that already ran. */
function Arrival({ delayMs, children }: { delayMs: number; children: ReactNode }) {
  const [delay] = useState(delayMs);
  return (
    <div data-testid="search-row" className="ember-row-in" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** A desktop artist row: the same box as a song row (TrackRow's list
 *  density), so the two read as one list. */
export const ARTIST_ROW =
  'grid w-full min-w-0 items-center gap-3 rounded-md py-2 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The Artists section: up to three, round pictures, each opening its
 *  artist page. A phone shows them side by side as circles; a desktop
 *  window (`rows`, the owner's desktop pick) lists them as rows, a round
 *  picture with the name and "Artist" and an arrow, above the songs.
 *
 *  A desktop row is built like the song rows under it (TrackRow, list
 *  density): the same grid, gap, padding, radius and hover, so its
 *  background spans the whole row with the arrow inside, the picture lines
 *  up with the song covers and the arrow with the songs' last button.
 *  `playColumn`: the songs have their play button column on the left (the
 *  search page; the overlay's songs play from the right). */
export function SearchArtists({
  artists,
  layout = 'grid',
  playColumn = false,
}: {
  artists: SearchArtist[];
  layout?: 'grid' | 'rows';
  playColumn?: boolean;
}) {
  const rows = layout === 'rows';
  return (
    <section aria-label="Artists" data-testid="search-artists" data-layout={layout} className="py-cluster">
      <h3 className="px-row pb-inset text-xs font-semibold uppercase tracking-wider text-muted-foreground">Artists</h3>
      <div className={rows ? 'flex flex-col' : 'grid grid-cols-3 gap-inset'}>
        {artists.map((a) =>
          rows ? (
            <Link
              key={a.id}
              href={`/artist/${encodeURIComponent(a.id)}`}
              data-testid="search-artist-row"
              className={cn(
                ARTIST_ROW,
                playColumn ? 'grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[40px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
              )}
            >
              {playColumn && <span aria-hidden className="hidden size-8 @3xl:block" />}
              <span className="flex min-w-0 items-center gap-3">
                <Artwork
                  src={a.artworkUrl}
                  alt=""
                  shape="round"
                  loading="lazy"
                  className="grid size-art-xs shrink-0 place-items-center bg-art text-foreground/30"
                >
                  <ArtistIcon className="h-5 w-5" />
                </Artwork>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <span className="truncate text-xs text-muted-foreground">Artist</span>
                </span>
              </span>
              <span aria-hidden data-testid="search-artist-arrow" className="grid size-8 place-items-center text-muted-foreground">
                <ChevronRightIcon className="h-4 w-4" />
              </span>
            </Link>
          ) : (
            <Link
              key={a.id}
              href={`/artist/${encodeURIComponent(a.id)}`}
              className="flex min-w-0 flex-col items-center gap-inset rounded-md p-cluster text-center transition-colors hover:bg-card"
            >
              <Artwork
                src={a.artworkUrl}
                alt=""
                shape="round"
                loading="lazy"
                className="grid size-16 shrink-0 place-items-center bg-art text-foreground/30"
              >
                <ArtistIcon className="h-6 w-6" />
              </Artwork>
              <span className="w-full truncate text-sm font-semibold">{a.name}</span>
              <span className="text-xs text-muted-foreground">Artist</span>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

/** Presentational: the search results as they arrive, from a SearchView
 *  (lib/search/view). Rows only ever join at the end, and each one fades in
 *  a moment after the one above it, counted from the first row of the
 *  arrival it came with. Mount it with `key={query}` so a new query starts
 *  counting from the top again. */
export function SearchResults({
  view,
  platform,
  context,
  trailing,
  trailingPlayControl = false,
  currentId,
  isPlaying,
  likedIds,
  onPlay,
  onToggle,
  onLike,
  isUnavailable,
  artworkSrcFor,
}: SearchResultsProps) {
  // The row count the last render saw and where the newest arrival began
  // ("adjusting state while rendering": settled before anything mounts).
  const count = view.rows.length;
  const [seen, setSeen] = useState({ count: 0, batchStart: 0 });
  const batchStart = seen.count === count ? seen.batchStart : count > seen.count ? seen.count : 0;
  if (seen.count !== count) setSeen({ count, batchStart });

  if (!count) return <EmptyState className="text-sm">No tracks</EmptyState>;

  const desktop = platform === 'desktop';
  const delayFor = (i: number) => Math.min(Math.max(0, i - batchStart), MAX_STAGGER_ROWS) * STAGGER_MS;

  let trackIndex = 0;
  return (
    // A container query root, as in TrackList: the rows key their layout off
    // the space they actually have (the desktop dropdown is ~544px wide).
    <div className="@container flex flex-col">
      {view.rows.map((row, i) => {
        if (row.kind === 'artists') {
          return (
            <Arrival key={row.key} delayMs={delayFor(i)}>
              <SearchArtists artists={row.artists} layout={desktop ? 'rows' : 'grid'} playColumn={!trailingPlayControl} />
            </Arrival>
          );
        }
        const t = row.track;
        const index = trackIndex++;
        const unavailable = !!isUnavailable?.(t);
        return (
          <Arrival key={row.key} delayMs={delayFor(i)}>
            <TrackRow
              track={t}
              index={index}
              density="list"
              active={currentId === t.id}
              playing={isPlaying}
              liked={onLike ? likedIds.has(t.id) || likedIds.has(songKey(t)) : undefined}
              artworkSrc={artworkSrcFor?.(t) ?? undefined}
              onPlay={() => onPlay(t, view.tracks, context)}
              onToggle={onToggle}
              onLike={onLike ? () => onLike(t) : undefined}
              trailing={trailing?.(t)}
              trailingPlayControl={trailingPlayControl}
              unavailable={unavailable}
              songHref={songPageHref(t)}
              titleOpensSong={desktop}
              // Long names scroll on every screen; ones that fit stay still.
              marqueeTitle
            />
          </Arrival>
        );
      })}
    </div>
  );
}
