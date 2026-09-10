'use client';

import { useMemo } from 'react';
import { toast } from 'sonner';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { findLikedVariant, songKey } from '@/lib/songKey';
import type { TrackActions } from '@/components/track/TrackList';
import type { Track } from '@/types/track';

/** Everything a track list needs from the app: the player, the likes query
 *  and the like mutation, behind one object a page spreads into
 *  `<TrackList {...useTrackActions()} />`. The "1 like per song across
 *  variants" rule lives here and nowhere else. */
export function useTrackActions(): Required<TrackActions> {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();

  // Ids AND song keys: a row is "liked" when its own id is liked or when
  // any variant of the same song is (album / video / live versions).
  const likedIds = useMemo(() => {
    const keys = new Set<string>();
    for (const t of liked) {
      keys.add(t.id);
      keys.add(songKey(t));
    }
    return keys;
  }, [liked]);

  const onLike = (track: Track) => {
    if (!user) {
      toast.message('Sign in to like tracks', { description: 'Liking saves songs to your library.' });
      return;
    }
    // If a variant of this song is already liked, toggle THAT entry: keeps
    // "1 like per song" across album / music-video / live versions.
    const existing = findLikedVariant(track, liked);
    toggleLike.mutate({ track: existing ?? track, wasLiked: !!existing });
  };

  return {
    currentId: current?.id ?? null,
    isPlaying,
    likedIds,
    onPlay: playTrack,
    onToggle: toggle,
    onLike,
  };
}
