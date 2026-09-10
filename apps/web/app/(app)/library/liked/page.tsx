'use client';

import { CollectionPage } from '@/components/library/CollectionPage';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useQueryLikes } from '@/hooks/useLibrary';

const REF = { kind: 'liked' } as const;

export default function LikedPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const { data: tracks = [], isLoading } = useQueryLikes();
  const context = contextFor(REF);
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(REF, titleFor(REF), tracks);

  if (!user) return <div className="text-muted-foreground py-12 text-center">Sign in to see your library</div>;
  if (isLoading && !tracks.length && isOnline) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const offlineEmpty = !isOnline && tracks.length === 0;
  return (
    <CollectionPage
      eyebrow="Playlist"
      title={titleFor(REF)}
      meta={[countLabel(tracks.length)]}
      cover={{ src: null, icon: iconFor(REF) }}
      tracks={tracks}
      context={context}
      playback={playback}
      download={download}
      emptyMessage={
        offlineEmpty
          ? 'Offline. Open this once while online to see its songs.'
          : 'Nothing liked yet. Tap the heart on any song.'
      }
    />
  );
}
