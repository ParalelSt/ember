'use client';

import { use } from 'react';
import Link from 'next/link';
import { TrackList } from '@/components/track/TrackList';
import { PlayButton } from '@/components/primitives/PlayButton';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryAlbum } from '@/hooks/useLibrary';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';
import { formatTotalDuration } from '@/lib/format';
import { pickThumbnail } from '@/lib/artwork';

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryAlbum(id);
  const isOnline = useOnline();

  if (!isOnline) return <OfflinePlaceholder />;

  if (error) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        Album not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </div>
    );
  }
  if (isLoading || !data) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const { title, artist, artistId, year, thumbnails = [], tracks = [], trackCount, totalDurationSec } = data;
  const cover = pickThumbnail(thumbnails);
  const albumContext = { type: 'album' as const, albumId: id, albumTitle: title };
  const meta = [
    artistId ? null : artist,
    year ? String(year) : null,
    trackCount ? `${trackCount} tracks` : null,
    totalDurationSec ? formatTotalDuration(totalDurationSec) : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div
          className="h-44 w-44 md:h-56 md:w-56 rounded-md shadow-soft bg-card shrink-0 bg-cover bg-center"
          style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        />
        <div className="min-w-0">
          <div className="text-eyebrow">Album</div>
          <h1 className="text-hero-title">{title}</h1>
          <div className="mt-3 text-sm text-muted-foreground">
            {artistId ? (
              <Link href={`/artist/${artistId}`} className="font-semibold text-foreground hover:underline">
                {artist}
              </Link>
            ) : null}
            {meta.length > 0 && (artistId ? ' · ' : '') + meta.join(' · ')}
          </div>
        </div>
      </div>

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
