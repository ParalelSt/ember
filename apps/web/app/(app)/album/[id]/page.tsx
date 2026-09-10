'use client';

import { use, type ReactNode } from 'react';
import Link from 'next/link';
import { TrackList } from '@/components/track/TrackList';
import { PlayButton } from '@/components/primitives/PlayButton';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryAlbum } from '@/hooks/useLibrary';
import { OnlineOnly } from '@/components/OnlineOnly';
import { formatTotalDuration } from '@/lib/format';
import { pickThumbnail } from '@/lib/artwork';
import { EmptyState } from '@/components/page/EmptyState';
import { CollectionHeader } from '@/components/page/CollectionHeader';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OnlineOnly>
      <AlbumView id={id} />
    </OnlineOnly>
  );
}

function AlbumView({ id }: { id: string }) {
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryAlbum(id);

  if (error) {
    return (
      <EmptyState>
        Album not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </EmptyState>
    );
  }
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
    <div>
      <CollectionHeader
        variant="album"
        eyebrow="Album"
        title={title}
        meta={meta}
        cover={{ src: cover, icon: null, fallback: 'card' }}
      />

      <div className="flex items-center gap-3 mb-6">
        <PlayButton
          onClick={() => tracks.length && playTrack(tracks[0], tracks, albumContext)}
          disabled={!tracks.length}
          label="Play album"
        />
      </div>

      <TrackList tracks={tracks} showAlbum={false} context={albumContext} />
    </div>
  );
}
