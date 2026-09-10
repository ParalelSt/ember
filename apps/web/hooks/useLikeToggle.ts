'use client';

import { useMemo } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { findLikedVariant, songKey } from '@/lib/songKey';
import type { Track } from '@/types/track';

export interface LikeRule {
  /** Ids AND song keys of the liked list: a track is "liked" when its own id
   *  is liked or when any variant of the same song is (album / video / live
   *  versions). Lists need the whole set at once. */
  likedIds: Set<string>;
  /** The liked entry matching this track, or null. */
  likedEntry: (track: Track | null | undefined) => Track | null;
  /** Like the track, or unlike whichever variant of it is already liked. */
  toggle: (track: Track | null | undefined) => void;
}

/** The "1 like per song across variants" rule, in one place: which entry a
 *  heart reflects and which entry a toggle operates on. `useLikeToggle` (one
 *  track) and `useTrackActions` (a list) are both built on it. */
export function useLikeRule(): LikeRule {
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();

  const likedIds = useMemo(() => {
    const keys = new Set<string>();
    for (const t of liked) {
      keys.add(t.id);
      keys.add(songKey(t));
    }
    return keys;
  }, [liked]);

  const likedEntry = (track: Track | null | undefined) => findLikedVariant(track, liked);

  const toggle = (track: Track | null | undefined) => {
    if (!track) return;
    if (!user) {
      toast.message('Sign in to like tracks', { description: 'Liking saves songs to your library.' });
      return;
    }
    // If a variant of this song is already liked, toggle THAT entry: keeps
    // "1 like per song" across album / music-video / live versions.
    const existing = findLikedVariant(track, liked);
    toggleLike.mutate({ track: existing ?? track, wasLiked: !!existing });
  };

  return { likedIds, likedEntry, toggle };
}

/** The like state of a single track plus its toggle, for the player bar, the
 *  full-screen view and anywhere else showing one heart. */
export function useLikeToggle(track: Track | null | undefined): { liked: boolean; toggle: () => void } {
  const { likedEntry, toggle } = useLikeRule();
  return {
    liked: !!likedEntry(track),
    toggle: () => toggle(track),
  };
}
