'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UploadIcon } from '@/components/icons';
import { UploadTrackDialog } from '@/components/track/UploadTrackDialog';
import { CollectionPage } from '@/components/library/CollectionPage';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useQueryUploads } from '@/hooks/useLibrary';

const REF = { kind: 'uploads' } as const;

export default function UploadsPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const { data: tracks = [], isLoading } = useQueryUploads();
  const context = contextFor(REF);
  const playback = useCollectionPlayback(tracks, context);
  const download = useOfflinePin(REF, titleFor(REF), tracks);
  const [uploadOpen, setUploadOpen] = useState(false);

  if (!user) return <div className="text-muted-foreground py-12 text-center">Sign in to see your library</div>;
  if (isLoading && !tracks.length && isOnline) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const offlineEmpty = !isOnline && tracks.length === 0;
  return (
    <CollectionPage
      eyebrow="Playlist"
      title={titleFor(REF)}
      meta={[countLabel(tracks.length), 'shared by members of this server']}
      cover={{ src: null, icon: iconFor(REF) }}
      tracks={tracks}
      context={context}
      playback={playback}
      download={download}
      actions={
        <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
          <UploadIcon className="h-4 w-4" /> Upload
        </Button>
      }
      emptyMessage={
        offlineEmpty
          ? 'Offline. Open this once while online to see its songs.'
          : 'Nothing uploaded yet. Use Upload to add a song from your device; everyone on the server can then find it.'
      }
    >
      <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </CollectionPage>
  );
}
