'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { useLikeRule } from '@/hooks/useLikeToggle';
import { isUnavailable } from '@/lib/playback/queueNav';
import { localArtFor } from '@/lib/offlineNative';
import { useOfflineStore } from '@/stores/useOfflineStore';
import type { TrackActions } from '@/components/track/TrackList';
import type { Track } from '@/types/track';

/** Everything a track list needs from the app: the player, the likes query
 *  and the like mutation, behind one object a page spreads into
 *  `<TrackList {...useTrackActions()} />`. The "1 like per song across
 *  variants" rule comes from `useLikeRule`, which the player bar's
 *  `useLikeToggle` shares. */
export function useTrackActions(): Required<TrackActions> {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { likedIds, toggle: onLike } = useLikeRule();
  const artFiles = useOfflineStore((s) => s.artFiles);

  return {
    currentId: current?.id ?? null,
    isPlaying,
    likedIds,
    onPlay: playTrack,
    onToggle: toggle,
    onLike,
    // The "is this track dead" rule, handed to the list as a predicate so
    // every page that spreads these actions greys the same rows.
    isUnavailable,
    // Downloaded tracks keep their art locally: prefer that so a row still
    // shows a thumbnail when offline (the remote artworkUrl won't load).
    artworkSrcFor: (track: Track) => localArtFor(track, artFiles) ?? track.artworkUrl ?? null,
  };
}
