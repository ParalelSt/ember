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
  /** Whether the server has confirmed a track can no longer be streamed.
   *  A predicate rather than a flag on the row so the rule itself stays in
   *  `lib/playback/queueNav` and this list keeps taking data in. */
  isUnavailable?: (track: Track) => boolean;
  /** A downloaded track's local art URL, or null/undefined to fall back to
   *  `track.artworkUrl`. Lets an offline list show local artwork without
   *  this component reaching into the offline store itself. */
  artworkSrcFor?: (track: Track) => string | null;
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
  /** Opens the find-replacement dialog for an unavailable track. Omitted on
   *  lists where a replacement wouldn't be actionable (e.g. Recently
   *  played, search results). */
  onReplace?: (track: Track) => void;
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
  onReplace,
  currentId,
  isPlaying,
  likedIds,
  onPlay,
  onToggle,
  onLike,
  isUnavailable,
  artworkSrcFor,
}: Props) {
  if (!tracks?.length) return <EmptyState className="text-sm">No tracks</EmptyState>;

  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => {
        const unavailable = !!isUnavailable?.(t);
        return (
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
          artworkSrc={artworkSrcFor?.(t) ?? undefined}
          onPlay={() => onPlay(t, tracks, context)}
          onToggle={onToggle}
          onLike={onLike ? () => onLike(t) : undefined}
          onRemove={onRemove ? () => onRemove(t.id) : undefined}
          trailing={trailing?.(t)}
          unavailable={unavailable}
          onReplace={unavailable && onReplace ? () => onReplace(t) : undefined}
        />
        );
      })}
    </div>
  );
}
