'use client';

import { Artwork } from '@/components/primitives/Artwork';
import { LiveBadge } from '@/components/player/LiveBadge';
import { OfflineBadge } from '@/components/player/OfflineBadge';
import { TransportControls } from '@/components/player/TransportControls';
import { UnplayableMessage, useUnplayableMessage } from '@/components/player/UnplayableMessage';
import { useSwipeSkip } from '@/hooks/player/useSwipeSkip';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { isLiveTrack } from '@/lib/radio/station';
import type { Track } from '@/types/track';

export interface CarPlayerBarProps {
  track: Track;
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onRetry: () => void;
  onOpenQueue: () => void;
}

/** The player bar of the head unit's car layout (owner's pick, carlayout2
 *  option G): the cover, the title and artist, then previous, play and next
 *  at their car size. Swipe the cover (or the title) left for the next song,
 *  right for the one before. */
export function CarPlayerBar({ track, playing, onToggle, onNext, onPrev, onRetry, onOpenQueue }: CarPlayerBarProps) {
  const swipe = useSwipeSkip({ onNext, onPrev, enabled: true });
  const artSrc = useTrackArtSrc(track);
  const unplayable = useUnplayableMessage();
  const live = isLiveTrack(track);

  return (
    <div className="flex items-center gap-stack px-page-lg py-row">
      <div className="flex min-w-0 flex-1 items-center gap-block" data-testid="player-bar-now" {...swipe}>
        {unplayable ? (
          <UnplayableMessage size="desktop" onRetry={onRetry} onOpenQueue={onOpenQueue} />
        ) : (
          <>
            {/* As tall as the play button beside it: a big target to swipe. */}
            <Artwork src={artSrc} fallback="gradient" className="size-18 shrink-0 rounded-lg bg-art" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-cluster">
                <span className="truncate text-section-title" title={track.title}>
                  {track.title}
                </span>
                {live && <LiveBadge />}
              </div>
              <div className="truncate text-base text-muted-foreground" title={track.artist}>
                {track.artist}
              </div>
            </div>
          </>
        )}
        <OfflineBadge />
      </div>
      <TransportControls playing={playing} onToggle={onToggle} onNext={onNext} onPrev={onPrev} size="car" />
    </div>
  );
}
