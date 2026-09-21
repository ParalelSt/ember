'use client';

import type { MouseEvent } from 'react';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { Artwork } from '@/components/primitives/Artwork';
import { Button } from '@/components/ui/button';
import { PauseIcon, PlayIcon } from '@/components/icons';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** The player bar's chrome: the strip's own background, its top border and
 *  the safe-area stand-off that keeps it clear of Android's system
 *  navigation. On the <footer> rather than on either layout inside it, so
 *  the two cannot disagree, and shared with the design gallery's preview so
 *  that cannot drift either. */
export const PLAYER_BAR_CHROME =
  'shrink-0 bg-sidebar border-t border-sidebar-border flex flex-col safe-area-bottom';

/** Play/pause: a 48px hit box (what a finger presses) with a smaller 36px
 *  solid white disc drawn inside it, so the button sits in proportion with
 *  the 56px artwork without the tap target shrinking with it. The glyph is
 *  half the disc (18px), the same ratio the desktop disc uses. */
function BarPlayButton({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  const Glyph = playing ? PauseIcon : PlayIcon;
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onToggle}
      aria-label={playing ? 'Pause' : 'Play'}
      className="size-12 shrink-0 rounded-full text-foreground"
    >
      <span
        data-testid="phone-play-disc"
        className="flex size-9 items-center justify-center rounded-full bg-foreground text-background"
      >
        {/* The play triangle's weight sits left of its box: a whole pixel
            nudge centres it at 18px and keeps it crisp. */}
        <Glyph className={cn('size-4.5 fill-current', !playing && 'translate-x-px')} />
      </span>
    </Button>
  );
}

export interface PhonePlayerBarProps {
  track: Track;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onSeek: (sec: number) => void;
  /** Opens the full-screen view: a tap anywhere on the row except the play
   *  button. Previous, next and the queue live there. */
  onOpen: () => void;
}

/**
 * The phone player bar: the old one-row shape, stripped to what a glance
 * needs. A 56px artwork, the song name (16px, scrolling with MarqueeText
 * when it overflows) and artist (14px), and one play/pause button, a 36px
 * disc in a 48px hit box; the thin seek line under all of it. Previous,
 * next and the queue are not here: they live on the full-screen NowPlaying
 * view, which a tap on the bar opens. The name gets about 224px at a 390px
 * phone (194px at 360).
 *
 * The strip's own background, border and safe-area stand-off are not here:
 * they are PLAYER_BAR_CHROME above, on the <footer> that holds whichever of
 * the two bars the window calls for.
 */
export function PhonePlayerBar({
  track,
  playing,
  position,
  duration,
  onToggle,
  onSeek,
  onOpen,
}: PhonePlayerBarProps) {
  // Prefer a downloaded copy's own local art over the remote URL, the same
  // way the desktop bar's NowPlayingSummary does.
  const artSrc = useTrackArtSrc(track);

  // The whole row opens the full-screen view, except the play button:
  // pressing play must only play.
  const openUnlessButton = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onOpen();
  };

  return (
    <div data-testid="phone-player-bar" className="flex flex-col">
      <div
        data-testid="phone-player-row"
        onClick={openUnlessButton}
        className="flex cursor-pointer items-center gap-block px-block pt-row pb-cluster"
      >
        <div data-testid="phone-player-title-row" className="flex min-w-0 flex-1 items-center gap-row">
          <Artwork src={artSrc} className="size-art-bar shrink-0 rounded-md bg-black" />
          {/* min-w-0 flex-1: the marquee's box is sized by the row, never by
              the title inside it, which is what keeps measuring it stable. */}
          <div className="min-w-0 flex-1">
            <MarqueeText text={track.title} className="text-base font-semibold" />
            <div className="truncate text-sm text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        <BarPlayButton playing={playing} onToggle={onToggle} />
      </div>

      {/* The thin progress slider along the bottom edge: visible, draggable,
          no labels. Outside the row, so dragging it never opens anything. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row -mt-1" />
    </div>
  );
}
