'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { TrackMenu } from '@/components/track/menus/TrackMenu';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ACTION_CIRCLE, ACTION_CIRCLE_ON, ActionBar } from '@/components/page/ActionBar';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useLikeToggle } from '@/hooks/useLikeToggle';
import { useQueryTrack } from '@/hooks/useLibrary';
import { HeartIcon } from '@/components/icons';
import { OnlineOnly } from '@/components/OnlineOnly';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/page/EmptyState';

/** Shareable track page body, the landing target of /track/<videoId> links.
 *  The playlists' header and, under it, their action row: round Play, like
 *  and the song's menu (Share lives in there). Play runs the track through the normal player
 *  (radio mode queues related songs after it). The wrapping
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
  const { liked, toggle: toggleLike } = useLikeToggle(track);

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
    <div className="flex flex-col gap-stack">
      <CollectionHeader
        eyebrow="Song"
        title={track.title}
        meta={meta}
        cover={{ src: track.artworkUrl ?? null, icon: null, fallback: 'card' }}
      />
      <ActionBar>
        <PlayButton onClick={() => playTrack(track)} label={`Play ${track.title}`} />
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike' : 'Like'}
          title={liked ? 'Unlike' : 'Like'}
          className={cn(ACTION_CIRCLE, liked && ACTION_CIRCLE_ON)}
        >
          <HeartIcon className="size-5" />
        </button>
        <TrackMenu track={track} triggerClassName={cn(ACTION_CIRCLE, '[&_svg]:size-5')} />
      </ActionBar>
    </div>
  );
}
