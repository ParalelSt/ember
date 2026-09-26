'use client';

import type { ReactNode } from 'react';
import { TrackRow } from './TrackRow';
import { EmptyState } from '@/components/page/EmptyState';
import { songKey } from '@/lib/songKey';
import type { PlaybackContext, PlaylistPerson, Track } from '@/types/track';

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
  /** Hands every row TrackRow's `trailingPlayControl` shape: the play/pause
   *  button at the trailing end and the current row marked by its title.
   *  Only the search overlay passes it; default off leaves every other list
   *  exactly as it was. */
  trailingPlayControl?: boolean;
  /** Select mode: every row turns into a tick box (TrackRow's `onSelect`).
   *  Omit, or pass `selecting: false`, for the plain list. */
  selection?: { selecting: boolean; isSelected: (id: string) => boolean; toggle: (id: string) => void };
  /** "12 Jun" for a row, shown in select mode on a wide list. */
  addedLabel?: (track: Track) => string | undefined;
  /** Who added a song, on a collaborative playlist (TrackRow's `addedBy`). */
  addedBy?: (track: Track) => PlaylistPerson | null | undefined;
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
  trailingPlayControl = false,
  selection,
  addedLabel,
  addedBy,
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
    // A container query root, not just a viewport one: this list can sit in
    // full-width collection pages OR in the search overlay's ~544px popup on
    // a wide window, and the row's own layout (album/duration columns) needs
    // to key off the space it actually has, not window width. See TrackRow's
    // @3xl grid switch.
    <div className="@container flex flex-col">
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
          trailingPlayControl={trailingPlayControl}
          unavailable={unavailable}
          onReplace={unavailable && onReplace ? () => onReplace(t) : undefined}
          onSelect={selection?.selecting ? () => selection.toggle(t.id) : undefined}
          selected={selection?.selecting ? selection.isSelected(t.id) : false}
          addedLabel={selection?.selecting ? addedLabel?.(t) : undefined}
          addedBy={addedBy?.(t)}
        />
        );
      })}
    </div>
  );
}
