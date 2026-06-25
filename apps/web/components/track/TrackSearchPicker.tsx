'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchIcon, PlusIcon, RefreshIcon, PlayIcon, PauseIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { songKey } from '@/lib/songKey';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  /** Tracks already added — shown disabled with an "Added" badge so the user
   *  doesn't add them twice. */
  added?: Track[];
  /** Seed tracks for recommendations when the search bar is empty. The first
   *  track's sourceId is used as the seed; passing an empty array gives
   *  generic/trending recommendations from the YouTube endpoint. */
  seeds?: Track[];
  onAdd: (track: Track) => void;
  className?: string;
}

/** Search + recommendations panel for picking tracks. Used inside the
 *  CreatePlaylistDialog and on the playlist detail page. Behaves like the
 *  main /search page (debounced, same `api.search`), with a recommendations
 *  fallback when the input is empty. */
export function TrackSearchPicker({ added = [], seeds = [], onAdd, className }: Props) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  // Bumped by the refresh button — also cycles the active seed across the
  // available seeds, so each click feels like a fresh pull instead of the
  // same watch-next list for the same seed.
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const searching = debouncedQ.trim().length > 0;

  const searchQuery = useQuery({
    queryKey: QK.search(debouncedQ),
    queryFn: () => api.search(debouncedQ).then((r) => r.tracks),
    enabled: searching,
  });

  const seed = seeds.length > 0 ? seeds[refreshNonce % seeds.length] : undefined;
  const seedSourceId = seed?.sourceId;
  const recsQuery = useQuery({
    queryKey: [...QK.recommended(seedSourceId), refreshNonce] as const,
    queryFn: () => api.getRecommended(seedSourceId).then((r) => r.tracks),
    enabled: !searching,
  });

  const refreshRecs = () => setRefreshNonce((n) => n + 1);

  const addedIds = new Set(added.map((t) => t.id));
  const addedKeys = new Set(added.map(songKey));
  // Recommendations must never suggest a song already in the playlist (by id OR
  // variant — a different upload of the same track). Search results keep showing
  // the "Added" badge so a deliberate search still gives feedback.
  const list = searching
    ? searchQuery.data
    : (recsQuery.data ?? []).filter((t) => !addedIds.has(t.id) && !addedKeys.has(songKey(t)));
  const loading = searching ? searchQuery.isFetching : recsQuery.isFetching;

  return (
    <div className={cn('flex flex-col gap-3 min-h-0', className)}>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search for songs to add…"
          className="pl-10"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {searching
            ? `Results for "${debouncedQ}"`
            : seeds.length > 0
              ? 'Recommended for this playlist'
              : 'Recommended'}
        </div>
        {!searching && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={refreshRecs}
            disabled={recsQuery.isFetching}
            aria-label="Refresh recommendations"
            title="Refresh recommendations"
          >
            <RefreshIcon className={cn('h-3.5 w-3.5', recsQuery.isFetching && 'animate-spin')} />
          </Button>
        )}
      </div>

      {/* Wrapper provides visual padding above + below the scrollable element
          so the native scrollbar's rounded thumb tips don't touch the edges. */}
      <div className="py-3">
        <div className="flex flex-col gap-1 overflow-y-auto max-h-96 md:max-h-[60vh] pr-2">
          {loading && !list?.length && (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        )}
        {!loading && !list?.length && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            {searching ? 'No results.' : 'Nothing to recommend yet.'}
          </div>
        )}
        {(list ?? []).map((t) => {
          const isAdded = addedIds.has(t.id);
          const playing = current?.id === t.id;
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent/60 transition-colors"
            >
              {t.artworkUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.artworkUrl} alt="" className="h-10 w-10 rounded shrink-0 object-cover bg-black" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-sm font-medium', playing && 'text-ember')}>{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
              </div>
              {/* Preview play/pause — plays just this track (then flows into radio). */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (playing ? toggle() : playTrack(t))}
                aria-label={playing && isPlaying ? 'Pause' : 'Play'}
                className={cn('h-8 w-8 shrink-0', playing ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground')}
              >
                {playing && isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAdd(t)}
                disabled={isAdded}
                className={cn('h-8 shrink-0 gap-1', isAdded && 'text-muted-foreground')}
              >
                {isAdded ? 'Added' : (<><PlusIcon className="h-3.5 w-3.5" /> Add</>)}
              </Button>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
