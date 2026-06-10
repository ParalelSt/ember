'use client';

import { use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ShareButton } from '@/components/track/ShareButton';
import { AddToPlaylistMenu } from '@/components/track/AddToPlaylistMenu';
import { PlayIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryTrack } from '@/hooks/useLibrary';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Shareable track page — the landing target of /track/<videoId> links.
 *  Mirrors the album page's header layout; Play runs the track through the
 *  normal player (radio mode queues related songs after it). */
export default function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { playTrack } = usePlayer();
  const { data: track, isLoading, error } = useQueryTrack(id);
  const isOnline = useOnline();

  if (!isOnline) return <OfflinePlaceholder />;

  if (error) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        Track not found.<br />
        <Link href="/" className="text-ember hover:underline">Home</Link>
      </div>
    );
  }
  if (isLoading || !track) return <div className="text-muted-foreground py-12 text-center">Loading…</div>;

  const meta = [track.album, fmt(track.durationSec)].filter(Boolean);

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <div
          className="h-44 w-44 md:h-56 md:w-56 rounded-md shadow-soft bg-card shrink-0 bg-cover bg-center"
          style={track.artworkUrl ? { backgroundImage: `url(${track.artworkUrl})` } : undefined}
        />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Track</div>
          <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight leading-tight">{track.title}</h1>
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
        <Button
          size="icon"
          onClick={() => playTrack(track)}
          className="h-12 w-12 rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow"
          aria-label={`Play ${track.title}`}
        >
          <PlayIcon className="h-5 w-5 fill-current ml-0.5" />
        </Button>
        <AddToPlaylistMenu track={track} />
        <ShareButton track={track} />
      </div>
    </div>
  );
}
