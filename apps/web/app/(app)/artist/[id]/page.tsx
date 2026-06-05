'use client';

import { use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { AlbumRow } from '@/components/artist/AlbumRow';
import { PlayIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryArtist } from '@/hooks/useLibrary';

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryArtist(id);

  if (error) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        Artist not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </div>
    );
  }
  if (isLoading || !data) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const { name, description, thumbnails = [], tracks = [], albums = [] } = data;
  const heroArt = thumbnails[thumbnails.length - 1]?.url;
  const artistContext = { type: 'artist' as const, artistName: name, artistId: id };

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div
          className="h-36 w-36 md:h-44 md:w-44 rounded-full shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)] shrink-0 bg-cover bg-center"
          style={heroArt ? { backgroundImage: `url(${heroArt})` } : undefined}
        />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Artist</div>
          <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight leading-tight">{name}</h1>
          {description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground line-clamp-3 leading-relaxed">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <Button
          size="icon"
          onClick={() => tracks.length && playTrack(tracks[0], tracks, artistContext)}
          disabled={!tracks.length}
          className="h-12 w-12 rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow"
          aria-label="Play top tracks"
        >
          <PlayIcon className="h-5 w-5 fill-current ml-0.5" />
        </Button>
      </div>

      <h2 className="mb-3 text-xl font-bold tracking-tight">Popular</h2>
      <div className="max-h-96 overflow-y-auto rounded-md mb-8">
        <TrackList tracks={tracks} context={artistContext} />
      </div>

      {albums.length > 0 && (
        <>
          <h2 className="mb-3 text-xl font-bold tracking-tight">Discography</h2>
          <AlbumRow albums={albums} />
        </>
      )}
    </div>
  );
}
