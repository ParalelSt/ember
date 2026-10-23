'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useExecuteAddToPlaylist, useExecuteCreatePlaylist } from '@/hooks/useLibrary';
import { formatCount } from '@/lib/format';
import { isAlreadyInPlaylist } from '@/lib/playlistAdd';
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
    let playlist;
    try {
      playlist = await createPlaylist.mutateAsync(name);
    } catch (e) {
      toast.error(`Couldn't create playlist: ${(e as Error).message}`);
      return;
    }
    // The playlist exists from here on, whatever happens to its songs.
    const failed = await addTracks(playlist.id, tracks, (v) => addToPlaylist.mutateAsync(v));
    createdToast(playlist.name, tracks.length, failed);
    onCreated?.();
    router.push(`/playlist/${playlist.id}`);
  };

  return { createOpen, setCreateOpen, handleCreate };
}

/** Adds `tracks` to a playlist that was just made, one after another, and
 *  answers how many could not be added (one already there counts as in). */
export async function addTracks(
  id: string,
  tracks: Track[],
  add: (v: { id: string; track: Track }) => Promise<unknown>,
): Promise<number> {
  let failed = 0;
  for (const track of tracks) {
    try {
      await add({ id, track });
    } catch (e) {
      if (!isAlreadyInPlaylist(e)) failed += 1;
    }
  }
  return failed;
}

/** "Created ..." once the playlist exists: with its songs, or saying how
 *  many of them did not make it (so nobody makes it a second time). */
export function createdToast(name: string, count: number, failed: number) {
  if (failed > 0) {
    toast.error(`Created "${name}", but ${formatCount(failed, 'track')} couldn't be added. Please try adding ${failed === 1 ? 'it' : 'them'} again.`);
  } else {
    toast.success(count ? `Created "${name}" with ${formatCount(count, 'track')}` : `Created "${name}"`);
  }
}
