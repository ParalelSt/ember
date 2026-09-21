'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

export interface PhonePlayerBarProps {
  track: Track;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  /** Opens the full-screen view: the song name and the artwork are the tap
   *  target for it, the way they were in the one-row bar. */
  onOpen: () => void;
  onQueue: () => void;
  /** The breakpoint gate. PlayerBar passes `md:hidden`; the design gallery
   *  draws the same bar inside a 390px frame on a desktop viewport, where a
   *  `md:` class would (wrongly) hide it, so it passes nothing. */
  className?: string;
}

/**
 * The phone player bar: two rows.
 *
 * Row one is the song name and artist across the whole width of the bar, so
 * a long name has 358px at a 390px phone instead of the 38px the old
 * [1fr auto 1fr] row left it, and it scrolls (MarqueeText) when even that is
 * not enough. Row two is artwork, the transport centred on the bar, and the
 * queue button, every box at or above Android's 48px minimum: play 56,
 * previous/next 48, queue 48, artwork 48.
 *
 * `safe-area-bottom` stands the whole bar off the bottom edge by the
 * safe-area inset, which on Android is the height of the system navigation
 * bar (see MainActivity) and everywhere else is 0.
 */
export function PhonePlayerBar({
  track,
  playing,
  position,
  duration,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onOpen,
  onQueue,
  className,
}: PhonePlayerBarProps) {
  // Prefer a downloaded copy's own local art over the remote URL, the same
  // way the desktop bar's NowPlayingSummary does.
  const artSrc = useTrackArtSrc(track);

  return (
    <footer
      data-testid="phone-player-bar"
      className={cn(
        'safe-area-bottom flex shrink-0 flex-col border-t border-sidebar-border bg-sidebar',
        className,
      )}
    >
      <div className="flex flex-col gap-cluster px-block pt-cluster pb-inset">
        <div
          data-testid="phone-player-title-row"
          onClick={onOpen}
          className="flex min-w-0 cursor-pointer"
        >
          {/* min-w-0 flex-1: the marquee's box is sized by the row, never by
              the title inside it, which is what keeps measuring it stable. */}
          <div className="min-w-0 flex-1">
            <MarqueeText text={track.title} className="text-sm font-semibold" />
            <div className="truncate text-xs text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        {/* [1fr auto 1fr] so the transport stays centred on the bar whatever
            sits either side of it. */}
        <div data-testid="phone-player-controls-row" className="grid grid-cols-[1fr_auto_1fr] items-center">
          <Artwork
            src={artSrc}
            size="sm"
            onClick={onOpen}
            className="shrink-0 cursor-pointer rounded-md bg-black"
          />
          <TransportControls
            playing={playing}
            onToggle={onToggle}
            onNext={onNext}
            onPrev={onPrev}
            size="phone"
          />
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-muted-foreground hover:text-foreground"
              onClick={onQueue}
              aria-label="Queue"
              title="Queue"
            >
              <QueueIcon className="size-6" />
            </Button>
          </div>
        </div>
      </div>

      {/* The thin progress slider along the bottom edge: visible, draggable,
          no labels. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row pb-inset" />
    </footer>
  );
}
