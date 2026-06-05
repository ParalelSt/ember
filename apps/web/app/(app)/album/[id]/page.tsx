'use client';

import { use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { PlayIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryAlbum } from '@/hooks/useLibrary';

function fmtTotal(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryAlbum(id);

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
  const cover = thumbnails[thumbnails.length - 1]?.url;
  const albumContext = { type: 'album' as const, albumId: id, albumTitle: title };
  const meta = [
    artistId ? null : artist,
    year ? String(year) : null,
    trackCount ? `${trackCount} tracks` : null,
    totalDurationSec ? fmtTotal(totalDurationSec) : null,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div
          className="h-44 w-44 md:h-56 md:w-56 rounded-md shadow-soft bg-card shrink-0 bg-cover bg-center"
          style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Album</div>
          <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight leading-tight">{title}</h1>
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
        <Button
          size="icon"
          onClick={() => tracks.length && playTrack(tracks[0], tracks, albumContext)}
          disabled={!tracks.length}
          className="h-12 w-12 rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow"
          aria-label="Play album"
        >
          <PlayIcon className="h-5 w-5 fill-current ml-0.5" />
        </Button>
      </div>

      <TrackList tracks={tracks} showAlbum={false} context={albumContext} />
    </div>
  );
}
