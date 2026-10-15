'use client';

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { QK } from '@/hooks/useLibrary';
import { api } from '@/lib/api';
import { contextFor, sameContext, type CollectionRef } from '@/lib/collections';
import type { Track } from '@/types/track';

export interface PlayCollection {
  /** Start the collection from its first song, or play/pause it when it is
   *  already the one playing. */
  play: (ref: CollectionRef, name?: string) => Promise<void>;
  /** The collection is the player's context and the player is playing. */
  isPlaying: (ref: CollectionRef) => boolean;
}

/** Play a whole collection from somewhere other than its own page (the
 *  desktop Home's hover play buttons). Its songs come from the same cache
 *  the collection's page reads (as it is, so an edit in flight there is
 *  never overwritten), fetched first when nothing is cached yet. Liked
 *  songs and playlists only: the other kinds have no button that asks. */
export function usePlayCollection(): PlayCollection {
  const qc = useQueryClient();
  const { isPlaying: playerPlaying, playTrack, toggle } = usePlayer();
  const context = usePlayerStore((s) => s.context);

  const isCurrent = (ref: CollectionRef) => sameContext(context, contextFor(ref));

  const songsOf = async (ref: CollectionRef): Promise<Track[]> => {
    if (ref.kind === 'liked') {
      return qc.ensureQueryData({ queryKey: QK.likes, queryFn: () => api.listLikes().then((r) => r.tracks) });
    }
    if (ref.kind === 'playlist') {
      const data = await qc.ensureQueryData({ queryKey: QK.playlist(ref.id), queryFn: () => api.getPlaylist(ref.id) });
      return data.tracks;
    }
    return [];
  };

  const play = async (ref: CollectionRef, name?: string) => {
    if (isCurrent(ref)) {
      toggle();
      return;
    }
    let tracks: Track[];
    try {
      tracks = await songsOf(ref);
    } catch {
      toast.error(`Couldn't load ${name ?? 'that'} right now`);
      return;
    }
    if (tracks.length === 0) {
      toast(`${name ?? 'It'} has no songs yet`);
      return;
    }
    playTrack(tracks[0], tracks, contextFor(ref, name));
  };

  return { play, isPlaying: (ref) => playerPlaying && isCurrent(ref) };
}
