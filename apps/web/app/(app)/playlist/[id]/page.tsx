'use client';

import { use, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TrackSearchPicker } from '@/components/track/TrackSearchPicker';
import { TrashIcon } from '@/components/icons';
import { CollectionPage } from '@/components/library/CollectionPage';
import { countLabel } from '@/lib/collections';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import {
  useExecuteAddToPlaylist,
  useExecuteDeletePlaylist,
  useExecuteRemoveFromPlaylist,
  useExecuteUpdatePlaylistArtwork,
  useQueryPlaylist,
} from '@/hooks/useLibrary';
import type { Track } from '@/types/track';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, error } = useQueryPlaylist(id);
  const deletePlaylist = useExecuteDeletePlaylist();
  const removeFromPlaylist = useExecuteRemoveFromPlaylist();
  const addToPlaylist = useExecuteAddToPlaylist();
  const updateArtwork = useExecuteUpdatePlaylistArtwork();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Track | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hooks must run before the early returns below. `data` may be undefined
  // here on first render.
  const tracks = data?.tracks ?? [];
  const name = data?.playlist.name ?? '';
  const ref = { kind: 'playlist', id } as const;
  const context = { type: 'playlist' as const, playlistId: id, playlistName: name };
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(ref, name, tracks);

  const handleArtworkPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // allow re-selecting the same file
    if (!file) return;
    updateArtwork.mutate(
      { id, file },
      {
        onSuccess: () => toast.success('Cover updated'),
        onError: (err) => toast.error(`Couldn't update cover: ${(err as Error).message}`),
      },
    );
  };

  const handleAdd = async (track: Track) => {
    try {
      await addToPlaylist.mutateAsync({ id, track });
      toast.success(`Added "${track.title}"`);
    } catch (e) {
      const status = (e as { status?: number } | undefined)?.status;
      if (status === 400) toast.message(`"${track.title}" is already in this playlist`);
      else toast.error(`Couldn't add "${track.title}", please try again.`);
    }
  };

  if (error) {
    return (
      <EmptyState>
        Playlist not found.
        <br />
        <Link href="/library" className="text-ember hover:underline">Back to library</Link>
      </EmptyState>
    );
  }
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const { playlist } = data;

  const handleDelete = async () => {
    try {
      await deletePlaylist.mutateAsync(id);
      toast.success(`Deleted "${playlist.name}"`);
      router.push('/library');
    } catch (e) {
      toast.error(`Couldn't delete the playlist, please try again.`);
      throw e; // keep the dialog open on failure
    }
  };

  const handleConfirmRemove = async () => {
    const track = pendingRemove;
    if (!track) return;
    try {
      await removeFromPlaylist.mutateAsync({ id, trackId: track.id });
      toast.success(`Removed "${track.title}"`);
      setPendingRemove(null);
    } catch (e) {
      toast.error(`Couldn't remove that, please try again.`);
      throw e;
    }
  };

  return (
    <CollectionPage
      eyebrow="Playlist"
      title={playlist.name}
      meta={[countLabel(tracks.length)]}
      cover={{ src: playlist.artwork_url, icon: null }}
      onCoverClick={() => fileInputRef.current?.click()}
      coverLabel="Change playlist cover"
      coverBusy={updateArtwork.isPending}
      tracks={tracks}
      context={context}
      playback={playback}
      download={download}
      actions={
        <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteOpen(true)} aria-label="Delete playlist">
          <TrashIcon className="h-4 w-4" />
        </Button>
      }
      onRemoveTrack={(trackId) => {
        const track = tracks.find((t) => t.id === trackId);
        if (track) setPendingRemove(track);
      }}
      emptyMessage="No tracks yet."
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleArtworkPick}
      />

      <section className="mt-10 max-w-3xl">
        <SectionHeader title="Add songs" className="mb-3" />
        <TrackSearchPicker added={tracks} seeds={tracks} onAdd={handleAdd} />
      </section>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete "${playlist.name}"?`}
        description="This can't be undone. The tracks themselves stay in your library."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title="Remove from playlist?"
        description={pendingRemove ? `"${pendingRemove.title}" by ${pendingRemove.artist || 'Unknown'} will be removed from this playlist. The track itself stays in your library.` : ''}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleConfirmRemove}
      />
    </CollectionPage>
  );
}
