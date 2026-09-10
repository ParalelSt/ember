'use client';

import type { ReactNode } from 'react';
import { TrackRow } from './TrackRow';
import { EmptyState } from '@/components/page/EmptyState';
import { songKey } from '@/lib/songKey';
import type { PlaybackContext, Track } from '@/types/track';

/** What a page has to hand a track list: who is playing, what is liked, and
 *  the three callbacks. `hooks/useTrackActions` produces exactly this, and
 *  is the only place the "a liked variant counts as liked" rule lives. */
export interface TrackActions {
  currentId: string | null;
  isPlaying: boolean;
  /** Track ids AND normalized song keys of every liked track, so a
   *  different upload of a liked song still shows a filled heart. */
  likedIds: Set<string>;
  onPlay: (track: Track, list?: Track[], context?: PlaybackContext | null) => void;
  onToggle: () => void;
  /** Omit to hide the heart on every row. */
  onLike?: (track: Track) => void;
}

interface Props extends TrackActions {
  tracks: Track[];
  showAlbum?: boolean;
  /** Show a 1-based rank number in the leading column, hidden on hover so
   *  the play/pause button takes over. Used on the artist "Popular" list. */
  showRank?: boolean;
  onRemove?: (trackId: string) => void;
  /** Where this list lives: drives radio behavior after the queue ends. */
  context?: PlaybackContext | null;
  /** Per-row controls before the heart. Pages pass `renderTrackMenu`; this
   *  list stays presentational and never reaches for the playlist hooks. */
  trailing?: (track: Track) => ReactNode;
}

/** Presentational only: the rows of a collection, album, artist or search
 *  result. Every piece of state arrives as props. */
export function TrackList({
  tracks,
  showAlbum = true,
  showRank = false,
  onRemove,
  context,
  trailing,
  currentId,
  isPlaying,
  likedIds,
  onPlay,
  onToggle,
  onLike,
}: Props) {
  if (!tracks?.length) return <EmptyState className="text-sm">No tracks</EmptyState>;

  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id}
          track={t}
          index={i}
          density="list"
          showRank={showRank}
          showAlbum={showAlbum}
          active={currentId === t.id}
          playing={isPlaying}
          // The set carries ids and song keys, so this covers variants too.
          liked={onLike ? likedIds.has(t.id) || likedIds.has(songKey(t)) : undefined}
          onPlay={() => onPlay(t, tracks, context)}
          onToggle={onToggle}
          onLike={onLike ? () => onLike(t) : undefined}
          onRemove={onRemove ? () => onRemove(t.id) : undefined}
          trailing={trailing?.(t)}
        />
      ))}
    </div>
  );
}
