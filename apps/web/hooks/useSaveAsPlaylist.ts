'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import type { Playlist, Track } from '@/types/track';

/** "Save as playlist" for a generated list (a chart, a mix): a new playlist
 *  of yours with these songs, in this order. A snapshot: the chart or mix
 *  moves on, the playlist stays. */
export function useSaveAsPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, tracks }: { name: string; tracks: Track[] }): Promise<Playlist> => {
      const { playlist } = await api.createPlaylist(name);
      if (tracks.length) await api.bulkAddToPlaylist(playlist.id, tracks);
      return playlist;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK.playlists });
    },
  });
}
