'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShareButton } from '@/components/track/ShareButton';
import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryTrack } from '@/hooks/useLibrary';
import { OnlineOnly } from '@/components/OnlineOnly';
import { formatTime } from '@/lib/format';
import { EmptyState } from '@/components/page/EmptyState';

/** Shareable track page body — the landing target of /track/<videoId> links.
 *  Mirrors the album page's header layout; Play runs the track through the
 *  normal player (radio mode queues related songs after it). The wrapping
 *  server page owns generateMetadata (Discord/Messenger embed cards). */
export function TrackPageClient({ videoId }: { videoId: string }) {
  return (
    <OnlineOnly>
      <TrackView videoId={videoId} />
    </OnlineOnly>
  );
}

function TrackView({ videoId }: { videoId: string }) {
  const { playTrack } = usePlayer();
  const { data: track, isLoading, error } = useQueryTrack(videoId);

  if (error) {
    return (
      <EmptyState>
        Track not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </EmptyState>
    );
  }
  if (isLoading || !track) return <EmptyState>Loading…</EmptyState>;

  // The artist leads the meta line, linked when we know its id.
  const meta: ReactNode[] = [
    track.artistId ? (
      <Link key="artist" href={`/artist/${track.artistId}`} className="font-semibold text-foreground hover:underline">
        {track.artist}
      </Link>
    ) : (
      <span key="artist" className="font-semibold text-foreground">{track.artist}</span>
    ),
    track.album,
    formatTime(track.durationSec, { empty: '' }),
  ].filter(Boolean);

  return (
    <div>
      <CollectionHeader
        variant="album"
        eyebrow="Track"
        title={track.title}
        meta={meta}
        cover={{ src: track.artworkUrl ?? null, icon: null, fallback: 'card' }}
      />

      <div className="flex items-center gap-3 mb-6">
        <PlayButton onClick={() => playTrack(track)} label={`Play ${track.title}`} />
        <AddToPlaylistMenu track={track} />
        <ShareButton track={track} />
      </div>
    </div>
  );
}
