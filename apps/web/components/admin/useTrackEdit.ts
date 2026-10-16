'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useExecuteUpdateAdminTrack } from '@/hooks/useAdmin';
import type { AdminTrack } from '@/lib/api';

/** The Edit track form's fields and Save, shared by the desktop dialog and
 *  the phone sheet. Only changed fields are sent. `onSaved` runs after a
 *  successful save (both close their dialog there). */
export function useTrackEdit(track: AdminTrack, onSaved: () => void) {
  const updateTrack = useExecuteUpdateAdminTrack();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateTrack.mutateAsync({
        recordId: track.recordId,
        patch: {
          title: title !== track.title ? title : undefined,
          artist: artist !== track.artist ? artist : undefined,
          album: album !== (track.album ?? '') ? album : undefined,
        },
      });
      toast.success('Track updated');
      onSaved();
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return { title, setTitle, artist, setArtist, album, setAlbum, busy, save };
}
