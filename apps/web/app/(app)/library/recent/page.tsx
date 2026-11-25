'use client';

import { CollectionPage } from '@/components/library/CollectionPage';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useAuth } from '@/components/providers/AuthProvider';
import { contextFor, countLabel, iconFor, titleFor } from '@/lib/collections';
import { useOnline } from '@/lib/useOnline';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useOfflinePin } from '@/hooks/useOfflinePin';
import { useQueryHistory } from '@/hooks/useLibrary';
import { useHeldOrder } from '@/hooks/useHeldOrder';
import { EmptyState } from '@/components/page/EmptyState';
import { ClockIcon } from '@/components/icons';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';

const REF = { kind: 'recent' } as const;

function NewRecentPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const { data: history = [], isLoading, isError } = useQueryHistory();
  // Playing a song moves it to the top of the history cache at once; keep
  // the order this page was opened with so the song does not jump away.
  const tracks = useHeldOrder(history);
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
          : 'Songs you play show up here.'
      }
      empty={
        offlineEmpty
          ? undefined
          : { icon: <ClockIcon />, title: 'Nothing played yet', action: { label: 'Find songs', href: '/search' } }
      }
    />
  );
}

/** The Classic look's page (docs/classic-look.md), loaded only on a
 *  device that chose it. */
const LegacyRecentPage = dynamic(() => import('@legacy/app/library/recent/page'));

export default uiSwitch(NewRecentPage, LegacyRecentPage);
