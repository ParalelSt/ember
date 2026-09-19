'use client';

import { use, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TrackSearchPicker } from '@/components/track/menus/TrackSearchPicker';
import { TrashIcon } from '@/components/icons';
import { CollectionPage } from '@/components/library/CollectionPage';
import { ReplaceTrackDialog } from '@/components/track/menus/ReplaceTrackDialog';
import { TrackMenu } from '@/components/track/menus/TrackMenu';
import { ImportBanner } from '@/components/import/ImportBanner';
import { ImportTrackList } from '@/components/import/ImportTrackList';
import { ReviewSheet } from '@/components/import/ReviewSheet';
import { SOURCE_NAME } from '@/components/import/parts';
import { useImportActions, useImportJob } from '@/hooks/useImports';
import { useImportReview } from '@/hooks/useImportReview';
import { isActive } from '@/lib/import/jobState';
import { importRows, itemForTrack } from '@/lib/import/rows';
import type { ImportItem } from '@/lib/import/types';
import { useTrackActions } from '@/hooks/useTrackActions';
import { countLabel, pinIdFor } from '@/lib/collections';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { localArtFor } from '@/lib/offlineNative';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';
import {
  useExecuteAddToPlaylist,
  useExecuteDeletePlaylist,
  useExecuteRemoveFromPlaylist,
  useExecuteReplaceInPlaylist,
  useExecuteUpdatePlaylistArtwork,
  useQueryPlaylist,
  QK,
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
  const replaceInPlaylist = useExecuteReplaceInPlaylist();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Track | null>(null);
  const [pendingReplace, setPendingReplace] = useState<Track | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Hooks must run before the early returns below. `data` may be undefined
  // here on first render.
  const tracks = data?.tracks ?? [];
  const name = data?.playlist.name ?? '';
  const ref = { kind: 'playlist', id } as const;
  const context = { type: 'playlist' as const, playlistId: id, playlistName: name };
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(ref, name, tracks);
  const trackActions = useTrackActions();

  // An imported playlist: follow its job, and refetch the tracks whenever
  // the job moves so rows land as they are matched.
  const importJob = useImportJob(data?.playlist.import_job);
  const job = importJob.data?.job ?? null;
  const items = importJob.data?.items ?? [];
  const importActions = useImportActions(job?.id, id);
  const review = useImportReview(items);
  const progressKey = job ? `${job.status}:${job.cursor}:${job.accepted}` : '';
  useEffect(() => {
    if (progressKey) void qc.invalidateQueries({ queryKey: QK.playlist(id) });
  }, [progressKey, qc, id]);

  // Offline, the remote cover URL can't load. When this playlist is pinned,
  // fall back to whichever downloaded track has local art, so the header
  // isn't blank instead of the actual cover.
  const isOnline = useOnline();
  const isPinned = useOfflineStore((s) => s.downloaded.includes(pinIdFor(ref)));
  const artFiles = useOfflineStore((s) => s.artFiles);
  const localCoverSrc = !isOnline && isPinned
    ? (tracks.map((t) => localArtFor(t, artFiles)).find((src) => src) ?? null)
    : null;

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
  const showImport = !!job && !job.dismissed;
  const toReview = items.filter((i) => i.status === 'review' || i.status === 'missing').length;
  const importing = !!job && isActive(job.status);
  const meta = job
    ? [`From ${SOURCE_NAME[job.source]}`, importing ? `${job.cursor} of ${job.total} songs` : countLabel(tracks.length)]
    : [countLabel(tracks.length)];

  const trailing = (t: Track) => {
    const item = job ? itemForTrack(items, t) : null;
    return <TrackMenu track={t} onRematch={item ? () => review.openRematch(item) : undefined} />;
  };

  const act = (action: 'cancel' | 'retry' | 'dismiss') =>
    importActions.update.mutate(action, {
      onError: (e) => toast.error((e as Error).message),
    });

  const handlePick = (item: ImportItem, track: Track) => {
    const rematch = review.mode === 'rematch';
    importActions.pick.mutate(
      { itemId: item.id, track },
      {
        onSuccess: () => {
          toast.success(`${rematch ? 'Swapped in' : 'Added'} "${track.title}"`);
          if (rematch) review.close();
          else review.advance();
        },
        onError: (e) => toast.error(`Couldn't add that song: ${(e as Error).message}`),
      },
    );
  };
  const handleRemoveItem = (item: ImportItem) =>
    importActions.skip.mutate(item.id, {
      onSuccess: () => review.advance(),
      onError: (e) => toast.error((e as Error).message),
    });

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
      meta={meta}
      cover={{ src: localCoverSrc ?? playlist.artwork_url, icon: null }}
      onCoverClick={() => fileInputRef.current?.click()}
      coverLabel="Change playlist cover"
      coverBusy={updateArtwork.isPending}
      tracks={tracks}
      context={context}
      trackActions={trackActions}
      trailing={trailing}
      playback={playback}
      download={download}
      banner={
        showImport ? (
          <ImportBanner
            job={job}
            toReview={toReview}
            busy={importActions.busy}
            onStop={() => act('cancel')}
            onRetry={() => act('retry')}
            onReview={() => review.openReview()}
            onDismiss={() => act('dismiss')}
          />
        ) : undefined
      }
      list={
        showImport ? (
          <ImportTrackList
            rows={importRows(items, tracks, job.status)}
            context={context}
            trailing={trailing}
            onRemove={(trackId) => {
              const track = tracks.find((t) => t.id === trackId);
              if (track) setPendingRemove(track);
            }}
            onReplace={setPendingReplace}
            onOpenItem={(item) => review.openReview(item)}
            {...trackActions}
          />
        ) : undefined
      }
      actions={
        <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteOpen(true)} aria-label="Delete playlist">
          <TrashIcon className="h-4 w-4" />
        </Button>
      }
      onRemoveTrack={(trackId) => {
        const track = tracks.find((t) => t.id === trackId);
        if (track) setPendingRemove(track);
      }}
      onReplaceTrack={setPendingReplace}
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

      {job && (
        <ReviewSheet
          open={review.open}
          onClose={review.close}
          mode={review.mode}
          playlistName={playlist.name}
          source={job.source}
          queue={review.queue}
          index={review.index}
          busy={importActions.busy}
          previewId={review.previewId}
          previewPlaying={review.previewPlaying}
          onPreview={review.onPreview}
          onPick={handlePick}
          onSkip={review.advance}
          onRemove={handleRemoveItem}
          searchResults={review.searchResults}
          searching={review.searching}
          onSearch={review.onSearch}
        />
      )}

      <ReplaceTrackDialog
        track={pendingReplace}
        open={!!pendingReplace}
        onOpenChange={(o) => { if (!o) setPendingReplace(null); }}
        onConfirm={async (r) => {
          await replaceInPlaylist.mutateAsync({ id, trackId: pendingReplace!.id, track: r });
          toast.success(`Replaced with "${r.title}"`);
        }}
      />
    </CollectionPage>
  );
}
