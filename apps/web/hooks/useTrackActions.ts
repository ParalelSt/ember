'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { useLikeRule } from '@/hooks/useLikeToggle';
import type { TrackActions } from '@/components/track/TrackList';

/** Everything a track list needs from the app: the player, the likes query
 *  and the like mutation, behind one object a page spreads into
 *  `<TrackList {...useTrackActions()} />`. The "1 like per song across
 *  variants" rule comes from `useLikeRule`, which the player bar's
 *  `useLikeToggle` shares. */
export function useTrackActions(): Required<TrackActions> {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { likedIds, toggle: onLike } = useLikeRule();

  return {
    currentId: current?.id ?? null,
    isPlaying,
    likedIds,
    onPlay: playTrack,
    onToggle: toggle,
    onLike,
  };
}
