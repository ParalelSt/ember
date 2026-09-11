'use client';

import { CollectionPage } from '@/components/library/CollectionPage';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useQueryLikes } from '@/hooks/useLibrary';
import { EmptyState } from '@/components/page/EmptyState';

const REF = { kind: 'liked' } as const;

export default function LikedPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const { data: tracks = [], isLoading, isError } = useQueryLikes();
  const context = contextFor(REF);
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(REF, titleFor(REF), tracks);
  const trackActions = useTrackActions();

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
      emptyMessage={
        offlineEmpty
          ? 'Offline. Open this once while online to see its songs.'
          : 'Nothing liked yet. Tap the heart on any song.'
      }
    />
  );
}
