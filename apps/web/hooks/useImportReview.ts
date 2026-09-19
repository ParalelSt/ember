'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '@/components/player/PlayerProvider';
import { api } from '@/lib/api';
import { reviewQueue } from '@/lib/import/rows';
import type { ImportItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

/** How long a candidate preview plays before it pauses itself. */
export const PREVIEW_MS = 20_000;

interface SheetState {
  mode: 'review' | 'rematch';
  /** The queue as it was when the sheet opened, so a picked song keeps its
   *  place while the index walks past it. */
  ids: string[];
  index: number;
}

/** The review sheet's state: which songs it walks, where it is, the
 *  candidate preview (a short play through the normal player) and the
 *  "none of these" search. */
export function useImportReview(items: ImportItem[]) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [searchResults, setSearchResults] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const queue = useMemo(
    () => (sheet ? sheet.ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as ImportItem] : [])) : []),
    [sheet, byId],
  );

  const openReview = useCallback(
    (start?: ImportItem) => {
      const ids = reviewQueue(items).map((i) => i.id);
      setSearchResults(null);
      setSheet({ mode: 'review', ids, index: Math.max(0, start ? ids.indexOf(start.id) : 0) });
    },
    [items],
  );
  const openRematch = useCallback((item: ImportItem) => {
    setSearchResults(null);
    setSheet({ mode: 'rematch', ids: [item.id], index: 0 });
  }, []);
  const close = useCallback(() => setSheet(null), []);
  const advance = useCallback(() => {
    setSearchResults(null);
    setSheet((s) => (s ? { ...s, index: s.index + 1 } : s));
  }, []);

  // Preview: play the candidate through the normal player, then pause it
  // after PREVIEW_MS if it is still the one playing.
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const latest = useRef({ current, isPlaying, toggle });
  useEffect(() => {
    latest.current = { current, isPlaying, toggle };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onPreview = useCallback(
    (track: Track) => {
      if (latest.current.current?.id === track.id) {
        latest.current.toggle();
        return;
      }
      playTrack(track, [track], null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const l = latest.current;
        if (l.current?.id === track.id && l.isPlaying) l.toggle();
      }, PREVIEW_MS);
    },
    [playTrack],
  );

  const onSearch = useCallback((q: string) => {
    setSearching(true);
    api
      .search(q)
      .then((r) => setSearchResults(r.tracks.filter((t) => t.source === 'youtube')))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, []);

  return {
    open: !!sheet,
    mode: sheet?.mode ?? 'review',
    index: sheet?.index ?? 0,
    queue,
    openReview,
    openRematch,
    close,
    advance,
    previewId: current?.id ?? null,
    previewPlaying: isPlaying,
    onPreview,
    searchResults,
    searching,
    onSearch,
  };
}
