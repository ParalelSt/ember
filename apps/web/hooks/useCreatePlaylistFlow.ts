'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useExecuteAddToPlaylist, useExecuteCreatePlaylist } from '@/hooks/useLibrary';
import { formatCount } from '@/lib/format';
import type { Track } from '@/types/track';

export interface UseCreatePlaylistFlowResult {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  handleCreate: (name: string, tracks: Track[]) => Promise<void>;
}

/** Creates a playlist, adds the given tracks, toasts the result and
 *  navigates to it. Was duplicated between Sidebar and Drawer; the only
 *  difference between the two call sites is Drawer also closing itself,
 *  which it does by passing `onCreated` (only on success, matching the
 *  original ordering: toast, then close, then navigate). */
export function useCreatePlaylistFlow(onCreated?: () => void): UseCreatePlaylistFlowResult {
  const router = useRouter();
  const createPlaylist = useExecuteCreatePlaylist();
  const addToPlaylist = useExecuteAddToPlaylist();
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreate = async (name: string, tracks: Track[]) => {
    try {
      const playlist = await createPlaylist.mutateAsync(name);
      for (const t of tracks) {
        await addToPlaylist.mutateAsync({ id: playlist.id, track: t });
      }
      toast.success(
        tracks.length ? `Created "${playlist.name}" with ${formatCount(tracks.length, 'track')}` : `Created "${playlist.name}"`,
      );
      onCreated?.();
      router.push(`/playlist/${playlist.id}`);
    } catch (e) {
      toast.error(`Couldn't create playlist: ${(e as Error).message}`);
    }
  };

  return { createOpen, setCreateOpen, handleCreate };
}
