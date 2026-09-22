'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CollectionPage } from '@/components/library/CollectionPage';
import { ReplaceTrackDialog } from '@/components/track/menus/ReplaceTrackDialog';
import { renderTrackMenu, TrackMenu } from '@/components/track/menus/TrackMenu';
import { TransferBlock } from '@/components/import/TransferBlock';
import { ReviewSheet } from '@/components/import/ReviewSheet';
import { useImportActions, useLikedImportJob } from '@/hooks/useImports';
import { useImportReview } from '@/hooks/useImportReview';
import { itemForTrack } from '@/lib/import/rows';
import { isActive } from '@/lib/import/jobState';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useExecuteReplaceLike, useQueryLikes, QK } from '@/hooks/useLibrary';
import { EmptyState } from '@/components/page/EmptyState';
import type { ImportItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

const REF = { kind: 'liked' } as const;

export default function LikedPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const { data: tracks = [], isLoading, isError } = useQueryLikes();
  const context = contextFor(REF);
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(REF, titleFor(REF), tracks);
  const trackActions = useTrackActions();
  const replaceLike = useExecuteReplaceLike();
  const [pendingReplace, setPendingReplace] = useState<Track | null>(null);

  // A transfer from another app: its songs become likes, so its progress,
  // its review and its not-found songs live on this page.
  const { job, items } = useLikedImportJob();
  const importActions = useImportActions(job?.id, null);
  const review = useImportReview(items);
  const qc = useQueryClient();
  const progressKey = job ? `${job.status}:${job.cursor}:${job.accepted}` : '';
  useEffect(() => {
    if (progressKey) void qc.invalidateQueries({ queryKey: QK.likes });
  }, [progressKey, qc]);

  if (!user) return <EmptyState>Sign in to see your library</EmptyState>;
  if (isLoading && !tracks.length && isOnline) return <EmptyState>Loading…</EmptyState>;
  if (isError && !tracks.length) return <EmptyState>Couldn&apos;t load this collection. Please try again.</EmptyState>;

  const offlineEmpty = !isOnline && tracks.length === 0;
  const showTransfer = !!job && !job.dismissed;
  const act = (action: 'cancel' | 'retry' | 'dismiss') =>
    importActions.update.mutate(action, { onError: (e) => toast.error((e as Error).message) });

  const handlePick = (item: ImportItem, track: Track) => {
    const rematch = review.mode === 'rematch';
    importActions.pick.mutate(
      { itemId: item.id, track },
      {
        onSuccess: () => {
          toast.success(`${rematch ? 'Swapped in' : 'Liked'} "${track.title}"`);
          if (rematch) review.close();
          else review.advance();
        },
        onError: (e) => toast.error(`Couldn't like that song: ${(e as Error).message}`),
      },
    );
  };
  const handleRemoveItem = (item: ImportItem) =>
    importActions.skip.mutate(item.id, {
      onSuccess: () => review.advance(),
      onError: (e) => toast.error((e as Error).message),
    });

  // While a transfer is on the page, a liked song it brought over can be
  // matched again from its row menu, the way an imported playlist's can.
  const trailing = showTransfer
    ? (t: Track) => {
        const item = itemForTrack(items, t);
        return <TrackMenu track={t} onRematch={item ? () => review.openRematch(item) : undefined} />;
      }
    : renderTrackMenu;

  return (
    <CollectionPage
      eyebrow="Playlist"
      title={titleFor(REF)}
      meta={[countLabel(tracks.length)]}
      cover={{ src: null, icon: iconFor(REF) }}
      tracks={tracks}
      context={context}
      trackActions={trackActions}
      trailing={trailing}
      playback={playback}
      download={download}
      hideActions={offlineEmpty}
      onReplaceTrack={setPendingReplace}
      banner={
        showTransfer ? (
          <TransferBlock
            job={job}
            items={items}
            busy={importActions.busy}
            onStop={() => act('cancel')}
            onRetry={() => act('retry')}
            onReview={() => review.openReview()}
            onDismiss={() => act('dismiss')}
            onOpenItem={(item) => review.openReview(item)}
            {...trackActions}
          />
        ) : undefined
      }
      emptyMessage={
        offlineEmpty
          ? 'Offline. Open this once while online to see its songs.'
          : showTransfer && isActive(job.status)
            ? 'The transferred songs land here as they are matched.'
            : 'Nothing liked yet. Tap the heart on any song.'
      }
    >
      {job && (
        <ReviewSheet
          open={review.open}
          onClose={review.close}
          mode={review.mode}
          playlistName={job.name}
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
          await replaceLike.mutateAsync({ oldId: pendingReplace!.id, track: r });
          toast.success(`Replaced with "${r.title}"`);
        }}
      />
    </CollectionPage>
  );
}
