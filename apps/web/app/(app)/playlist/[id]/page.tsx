'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TrackList } from '@/components/track/TrackList';
import { TrackSearchPicker } from '@/components/track/TrackSearchPicker';
import { PlayIcon, TrashIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import {
  useExecuteAddToPlaylist,
  useExecuteDeletePlaylist,
  useExecuteRemoveFromPlaylist,
  useQueryPlaylist,
} from '@/hooks/useLibrary';
import type { Track } from '@/types/track';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryPlaylist(id);
  const deletePlaylist = useExecuteDeletePlaylist();
  const removeFromPlaylist = useExecuteRemoveFromPlaylist();
  const addToPlaylist = useExecuteAddToPlaylist();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Track | null>(null);

  const handleAdd = async (track: Track) => {
    try {
      await addToPlaylist.mutateAsync({ id, track });
      toast.success(`Added "${track.title}"`);
    } catch (e) {
      const status = (e as { status?: number } | undefined)?.status;
      if (status === 400) toast.message(`"${track.title}" is already in this playlist`);
      else toast.error(`Couldn't add: ${(e as Error).message}`);
    }
  };

  if (error) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        Playlist not found.
        <br />
        <Link href="/library" className="text-ember hover:underline">Back to library</Link>
      </div>
    );
  }
  if (isLoading || !data) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const { playlist, tracks } = data;
  const playlistContext = { type: 'playlist' as const, playlistId: id, playlistName: playlist.name };

  const handleDelete = async () => {
    try {
      await deletePlaylist.mutateAsync(id);
      toast.success(`Deleted "${playlist.name}"`);
      router.push('/library');
    } catch (e) {
      toast.error(`Couldn't delete: ${(e as Error).message}`);
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
      toast.error(`Couldn't remove: ${(e as Error).message}`);
      throw e;
    }
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div className="h-44 w-44 md:h-48 md:w-48 rounded-2xl shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)] shrink-0" />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Playlist</div>
          <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight leading-tight">{playlist.name}</h1>
          <div className="mt-3 text-sm text-muted-foreground">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <Button
          size="icon"
          onClick={() => tracks.length && playTrack(tracks[0], tracks, playlistContext)}
          disabled={!tracks.length}
          className="h-12 w-12 rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow"
          aria-label="Play"
        >
          <PlayIcon className="h-5 w-5 fill-current ml-0.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteOpen(true)} aria-label="Delete playlist">
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>
      {tracks.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center">No tracks yet.</div>
      ) : (
        <TrackList
          tracks={tracks}
          context={playlistContext}
          onRemove={(trackId) => {
            const track = tracks.find((t) => t.id === trackId);
            if (track) setPendingRemove(track);
          }}
        />
      )}

      <section className="mt-10 max-w-3xl">
        <h2 className="mb-3 text-xl font-bold tracking-tight">Add songs</h2>
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
    </div>
  );
}
