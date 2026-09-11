'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CollectionPage } from '@/components/library/CollectionPage';
import { ReplaceTrackDialog } from '@/components/track/menus/ReplaceTrackDialog';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useExecuteReplaceLike, useQueryLikes } from '@/hooks/useLibrary';
import { EmptyState } from '@/components/page/EmptyState';
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

  if (!user) return <EmptyState>Sign in to see your library</EmptyState>;
  if (isLoading && !tracks.length && isOnline) return <EmptyState>Loading…</EmptyState>;
  if (isError && !tracks.length) return <EmptyState>Couldn&apos;t load this collection. Please try again.</EmptyState>;

  const offlineEmpty = !isOnline && tracks.length === 0;
  return (
    <CollectionPage
      eyebrow="Playlist"
      title={titleFor(REF)}
      meta={[countLabel(tracks.length)]}
      cover={{ src: null, icon: iconFor(REF) }}
      tracks={tracks}
      context={context}
      trackActions={trackActions}
      trailing={renderTrackMenu}
      playback={playback}
      download={download}
      hideActions={offlineEmpty}
      onReplaceTrack={setPendingReplace}
      emptyMessage={
        offlineEmpty
          ? 'Offline. Open this once while online to see its songs.'
          : 'Nothing liked yet. Tap the heart on any song.'
      }
    >
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
