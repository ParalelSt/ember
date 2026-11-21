'use client';

import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrackList } from '@/components/track/TrackList';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useTrackActions } from '@/hooks/useTrackActions';
import { AlbumShelf } from '@/components/artist/AlbumShelf';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ActionBar } from '@/components/page/ActionBar';
import { useQueryArtist } from '@/hooks/useLibrary';
import { OnlineOnly } from '@/components/OnlineOnly';
import { pickThumbnail } from '@/lib/artwork';
import { EmptyState } from '@/components/page/EmptyState';
import { BrowseError } from '@/components/page/BrowseError';
import { SectionHeader } from '@/components/page/SectionHeader';
import { RowNavProvider } from '@/components/page/RowNavContext';
import { useScrollTopOnChange } from '@/hooks/useScrollTopOnChange';
import { rowHref } from '@/lib/homeRows';

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OnlineOnly>
      <ArtistView id={id} />
    </OnlineOnly>
  );
}

function ArtistView({ id }: { id: string }) {
  const trackActions = useTrackActions();
  // "Show all" on a row opens that row alone as a full grid (?row=<key>).
  const rowParam = useSearchParams().get('row');
  useScrollTopOnChange(rowParam);
  const { data, isLoading, error, refetch } = useQueryArtist(id);

  if (error) return <BrowseError error={error} kind="Artist" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const { name, description, thumbnails = [], tracks = [], albums = [], singles = [] } = data;
  const heroArt = pickThumbnail(thumbnails);
  const path = `/artist/${id}`;
  const artistContext = { type: 'artist' as const, artistName: name, artistId: id };

  if (rowParam === 'albums' || rowParam === 'singles') {
    const albumsRow = rowParam === 'albums';
    return (
      <RowNavProvider value={{ fit: true, fullRow: true, backHref: path }}>
        <AlbumShelf title={albumsRow ? 'Discography' : 'Singles & EPs'} albums={albumsRow ? albums : singles} />
      </RowNavProvider>
    );
  }

  return (
    <div className="flex flex-col gap-stack">
      <CollectionHeader
        variant="artist"
        eyebrow="Artist"
        title={name}
        meta={[]}
        cover={{ src: heroArt, icon: null }}
        description={
          description ? (
            <p className="max-w-2xl text-sm text-muted-foreground line-clamp-3 leading-relaxed">{description}</p>
          ) : null
        }
      >
        <ActionBar>
          <PlayButton
            onClick={() => tracks.length && trackActions.onPlay(tracks[0], tracks, artistContext)}
            disabled={!tracks.length}
            label="Play top tracks"
          />
        </ActionBar>
      </CollectionHeader>

      <div className="flex flex-col gap-section">
        <section>
          <SectionHeader title="Popular" className="mb-block" />
          <div className="max-h-80 overflow-y-auto rounded-md">
            <TrackList
              tracks={tracks}
              context={artistContext}
              showRank
              trailing={renderTrackMenu}
              {...trackActions}
            />
          </div>
        </section>

        <RowNavProvider value={{ fit: true }}>
          <AlbumShelf title="Discography" albums={albums} showAllHref={rowHref(path, 'albums')} />
          <AlbumShelf title="Singles & EPs" albums={singles} showAllHref={rowHref(path, 'singles')} />
        </RowNavProvider>
      </div>
    </div>
  );
}
