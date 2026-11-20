'use client';

import { useMemo } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { canonicalId } from '@/lib/trackIdentity';
import type { Track } from '@/types/track';

export interface LikeRule {
  /** Canonical ids (canonicalId) of the liked list. A track is "liked" only
   *  when its own exact id is in here, never because a look-alike (another
   *  upload, a "(Slowed)" cut) is. Test with `likedIds.has(canonicalId(id))`.
   *  Lists need the whole set at once. */
  likedIds: Set<string>;
  /** The liked entry with this track's id, or null. */
  likedEntry: (track: Track | null | undefined) => Track | null;
  /** Like exactly this track, or unlike exactly this track. */
  toggle: (track: Track | null | undefined) => void;
}

/** The like rule, in one place: a heart is lit only for the exact track id
 *  that was liked. A different id is a different song as far as likes go,
 *  whatever its title and artist say. `useLikeToggle` (one track) and
 *  `useTrackActions` (a list) are both built on it. */
export function useLikeRule(): LikeRule {
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();

  const likedIds = useMemo(() => new Set(liked.map((t) => canonicalId(t.id))), [liked]);

  const likedEntry = (track: Track | null | undefined) => {
    if (!track) return null;
    const id = canonicalId(track.id);
    return liked.find((t) => canonicalId(t.id) === id) ?? null;
  };

  const toggle = (track: Track | null | undefined) => {
    if (!track) return;
    if (!user) {
      toast.message('Sign in to like tracks', { description: 'Liking saves songs to your library.' });
      return;
    }
    // Only an entry with this very id counts, so liking a variant adds that
    // track and unliking it never removes a different one.
    const existing = likedEntry(track);
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
