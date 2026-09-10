'use client';

import { use } from 'react';
import Link from 'next/link';
import { TrackList } from '@/components/track/TrackList';
import { AlbumRow } from '@/components/artist/AlbumRow';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryArtist } from '@/hooks/useLibrary';
import { OnlineOnly } from '@/components/OnlineOnly';
import { pickThumbnail } from '@/lib/artwork';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OnlineOnly>
      <ArtistView id={id} />
    </OnlineOnly>
  );
}

function ArtistView({ id }: { id: string }) {
  const { playTrack } = usePlayer();
  const { data, isLoading, error } = useQueryArtist(id);

  if (error) {
    return (
      <EmptyState>
        Artist not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </EmptyState>
    );
  }
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const { name, description, thumbnails = [], tracks = [], albums = [], singles = [] } = data;
  const heroArt = pickThumbnail(thumbnails);
  const artistContext = { type: 'artist' as const, artistName: name, artistId: id };

  return (
    <div>
      <CollectionHeader
        variant="artist"
        eyebrow="Artist"
        title={name}
        meta={[]}
        cover={{ src: heroArt, icon: null }}
        description={
          description ? (
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground line-clamp-3 leading-relaxed">{description}</p>
          ) : null
        }
      />
      <div className="flex items-center gap-3 mb-6">
        <PlayButton
          onClick={() => tracks.length && playTrack(tracks[0], tracks, artistContext)}
          disabled={!tracks.length}
          label="Play top tracks"
        />
      </div>

      <SectionHeader title="Popular" className="mb-3" />
      <div className="max-h-80 overflow-y-auto rounded-md mb-8">
        <TrackList tracks={tracks} context={artistContext} showRank />
      </div>

      {albums.length > 0 && (
        <>
          <SectionHeader title="Discography" className="mb-3" />
          <AlbumRow albums={albums} />
        </>
      )}

      {singles.length > 0 && (
        <>
          <SectionHeader title="Singles & EPs" className="mb-3 mt-8" />
          <AlbumRow albums={singles} />
        </>
      )}
    </div>
  );
}
