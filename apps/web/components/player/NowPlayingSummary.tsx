'use client';

import Link from 'next/link';
import { Artwork } from '@/components/primitives/Artwork';
import { MarqueeText } from '@/components/player/MarqueeText';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** 'sm' is the player bar's left cluster (artwork beside one line each);
 *  'lg' is the full-screen view's header, whose artwork is a separate block
 *  above it, so this only draws the title and artist there. */
export type NowPlayingSummarySize = 'sm' | 'lg';

// On phones the bar's artist link is inert so the tap falls through to the
// wrapper, which opens the full-screen view; artist navigation happens from
// inside that view instead. Desktop keeps the direct link.
const ARTIST_LINK: Record<NowPlayingSummarySize, string> = {
  sm: 'hover:underline pointer-events-none md:pointer-events-auto',
  lg: 'hover:underline',
};

const ARTIST_ROW: Record<NowPlayingSummarySize, string> = {
  sm: 'truncate text-xs text-muted-foreground',
  lg: 'mt-1 truncate text-sm text-muted-foreground',
};

export interface NowPlayingSummaryProps {
  track: Track | null;
  size: NowPlayingSummarySize;
  /** Tap handler for the whole cluster (the bar opens the full-screen view
   *  with it on phones). */
  onOpen?: () => void;
  /** Render the artist as a link to its page when the track has an artistId. */
  artistLink?: boolean;
  /** Runs after the artist link is followed, for a view that has to close
   *  itself before the navigation lands. */
  onArtistNavigate?: () => void;
  /** Only 'lg': scroll an overflowing title while the view is on screen. */
  marquee?: boolean;
  className?: string;
}

/** Artwork, title and artist for the track that is playing. */
export function NowPlayingSummary({
  track,
  size,
  onOpen,
  artistLink = true,
  onArtistNavigate,
  marquee,
  className,
}: NowPlayingSummaryProps) {
  // Prefer a downloaded copy's own local art (offline, or just to save data)
  // over the remote artworkUrl; shared with NowPlaying's full-screen artwork.
  const artSrc = useTrackArtSrc(track);

  const artist = artistLink && track?.artistId ? (
    <Link
      href={`/artist/${track.artistId}`}
      // stopPropagation keeps a click off the cluster's own open handler.
      onClick={(e) => {
        e.stopPropagation();
        onArtistNavigate?.();
      }}
      className={ARTIST_LINK[size]}
    >
      {track.artist}
    </Link>
  ) : (
    track?.artist ?? ''
  );

  if (size === 'lg') {
    return (
      <div className={cn('min-w-0', className)}>
        <MarqueeText text={track?.title ?? ''} active={marquee} className="text-2xl font-bold tracking-tight" />
        <div className={ARTIST_ROW.lg}>{artist}</div>
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      className={cn('flex items-center gap-3 min-w-0 flex-1 cursor-pointer md:cursor-default', className)}
    >
      {artSrc && (
        <Artwork src={artSrc} size="sm" className="rounded-md bg-black shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={track?.title ?? ''}>
          {track?.title ?? 'Nothing playing'}
        </div>
        <div className={ARTIST_ROW.sm} title={track?.artist ?? ''}>
          {artist}
        </div>
      </div>
    </div>
  );
}
