'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { PlayIcon, TrashIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import {
  useExecuteDeletePlaylist,
  useExecuteRemoveFromPlaylist,
  useQueryPlaylist,
} from '@/hooks/useLibrary';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryPlaylist(id);
  const deletePlaylist = useExecuteDeletePlaylist();
  const removeFromPlaylist = useExecuteRemoveFromPlaylist();

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
    if (!window.confirm(`Delete "${playlist.name}"?`)) return;
    await deletePlaylist.mutateAsync(id);
    router.push('/library');
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div className="h-44 w-44 md:h-48 md:w-48 rounded-2xl shadow-soft bg-gradient-to-br from-ember to-[oklch(0.3_0.15_25)] shrink-0" />
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
        <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Delete playlist">
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>
      {tracks.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center">No tracks yet.</div>
      ) : (
        <TrackList tracks={tracks} context={playlistContext} onRemove={(trackId) => removeFromPlaylist.mutate({ id, trackId })} />
      )}
    </div>
  );
}
