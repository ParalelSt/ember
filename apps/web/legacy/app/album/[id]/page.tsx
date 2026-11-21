'use client';

import { use, type ReactNode } from 'react';
import Link from 'next/link';
import { TrackList } from '@legacy/components/track/TrackList';
import { renderTrackMenu } from '@legacy/components/track/menus/TrackMenu';
import { useTrackActions } from '@/hooks/useTrackActions';
import { PlayButton } from '@legacy/components/primitives/PlayButton';
import { useQueryAlbum } from '@/hooks/useLibrary';
import { OnlineOnly } from '@legacy/components/OnlineOnly';
import { formatTotalDuration } from '@/lib/format';
import { pickThumbnail } from '@/lib/artwork';
import { EmptyState } from '@legacy/components/page/EmptyState';
import { BrowseError } from '@legacy/components/page/BrowseError';
import { CollectionHeader } from '@legacy/components/page/CollectionHeader';
import { ActionBar } from '@legacy/components/page/ActionBar';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OnlineOnly>
      <AlbumView id={id} />
    </OnlineOnly>
  );
}

function AlbumView({ id }: { id: string }) {
  const trackActions = useTrackActions();
  const { data, isLoading, error, refetch } = useQueryAlbum(id);

  if (error) return <BrowseError error={error} kind="Album" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const { title, artist, artistId, year, thumbnails = [], tracks = [], trackCount, totalDurationSec } = data;
  const cover = pickThumbnail(thumbnails);
  const albumContext = { type: 'album' as const, albumId: id, albumTitle: title };
  // The artist is the first meta entry and links out when we know its id.
  const meta: ReactNode[] = [
    artistId ? (
      <Link key="artist" href={`/artist/${artistId}`} className="font-semibold text-foreground hover:underline">
        {artist}
      </Link>
    ) : (
      artist
    ),
    year ? String(year) : null,
    trackCount ? `${trackCount} tracks` : null,
    totalDurationSec ? formatTotalDuration(totalDurationSec) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-stack">
      <CollectionHeader
        variant="album"
        eyebrow="Album"
        title={title}
        meta={meta}
        cover={{ src: cover, icon: null, fallback: 'card' }}
      >
        <ActionBar>
          <PlayButton
            onClick={() => tracks.length && trackActions.onPlay(tracks[0], tracks, albumContext)}
            disabled={!tracks.length}
            label="Play album"
          />
        </ActionBar>
      </CollectionHeader>

      <TrackList
        tracks={tracks}
        showAlbum={false}
        context={albumContext}
        trailing={renderTrackMenu}
        {...trackActions}
      />
    </div>
  );
}
