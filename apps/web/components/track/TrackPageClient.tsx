'use client';

import Link from 'next/link';
import { ShareButton } from '@/components/track/ShareButton';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { PlayButton } from '@/components/primitives/PlayButton';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryTrack } from '@/hooks/useLibrary';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';
import { formatTime } from '@/lib/format';
import { EmptyState } from '@/components/page/EmptyState';

/** Shareable track page body — the landing target of /track/<videoId> links.
 *  Mirrors the album page's header layout; Play runs the track through the
 *  normal player (radio mode queues related songs after it). The wrapping
 *  server page owns generateMetadata (Discord/Messenger embed cards). */
export function TrackPageClient({ videoId }: { videoId: string }) {
  const { playTrack } = usePlayer();
  const { data: track, isLoading, error } = useQueryTrack(videoId);
  const isOnline = useOnline();

  if (!isOnline) return <OfflinePlaceholder />;

  if (error) {
    return (
      <EmptyState>
        Track not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </EmptyState>
    );
  }
  if (isLoading || !track) return <EmptyState>Loading…</EmptyState>;

  const meta = [track.album, formatTime(track.durationSec, { empty: '' })].filter(Boolean);

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div
          className="h-44 w-44 md:h-56 md:w-56 rounded-md shadow-soft bg-card shrink-0 bg-cover bg-center"
          style={track.artworkUrl ? { backgroundImage: `url(${track.artworkUrl})` } : undefined}
        />
        <div className="min-w-0">
          <div className="text-eyebrow">Track</div>
          <h1 className="text-hero-title">{track.title}</h1>
          <div className="mt-3 text-sm text-muted-foreground">
            {track.artistId ? (
              <Link href={`/artist/${track.artistId}`} className="font-semibold text-foreground hover:underline">
                {track.artist}
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{track.artist}</span>
            )}
            {meta.length > 0 && ' · ' + meta.join(' · ')}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <PlayButton onClick={() => playTrack(track)} label={`Play ${track.title}`} />
        <AddToPlaylistMenu track={track} />
        <ShareButton track={track} />
      </div>
    </div>
  );
}
