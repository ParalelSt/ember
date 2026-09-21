'use client';

import type { MouseEvent } from 'react';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { Artwork } from '@/components/primitives/Artwork';
import { Button } from '@/components/ui/button';
import { NextIcon, PauseIcon, PlayIcon } from '@/components/icons';
import { useTrackArtSrc } from '@/lib/offlineNative';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** The player bar's chrome: the strip's own background and its top border.
 *  No safe-area stand-off here: MobileNav below it is the bottom-most
 *  element in the shell, so it alone carries the safe-area lift (applying
 *  it here too left an empty band under the seek line). On the <footer>
 *  rather than on either layout inside it, so the two cannot disagree, and
 *  shared with the design gallery's preview so that cannot drift either. */
export const PLAYER_BAR_CHROME =
  'shrink-0 bg-sidebar border-t border-sidebar-border flex flex-col';

/** Play/pause: a 48px hit box (what a finger presses) with a smaller 40px
 *  solid white disc drawn inside it, so the button sits in proportion with
 *  the 56px artwork without the tap target shrinking with it. The glyph is
 *  half the disc (20px), the same ratio the desktop disc uses. */
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
        className="flex size-10 items-center justify-center rounded-full bg-foreground text-background"
      >
        {/* The play triangle's weight sits left of its box: a whole pixel
            nudge centres it at 20px and keeps it crisp. */}
        <Glyph className={cn('size-5 fill-current', !playing && 'translate-x-px')} />
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
  onNext: () => void;
  /** Opens the full-screen view: a tap anywhere on the row except the two
   *  buttons. Previous and the queue live there. */
  onOpen: () => void;
}

/**
 * The phone player bar: the old one-row shape, stripped to what a glance
 * needs. A 56px artwork, the song name (16px, scrolling with MarqueeText
 * when it overflows) and artist (14px), play/pause (a 40px disc in a 48px
 * hit box) and next (a plain 24px glyph in a 48px hit box); the thin seek
 * line under all of it. Previous and the queue are not here: they live on
 * the full-screen NowPlaying view, which a tap on the bar opens. The name
 * gets about 176px at a 390px phone (146px at 360).
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
  onNext,
  onOpen,
}: PhonePlayerBarProps) {
  // Prefer a downloaded copy's own local art over the remote URL, the same
  // way the desktop bar's NowPlayingSummary does.
  const artSrc = useTrackArtSrc(track);

  // The whole row opens the full-screen view, except the buttons: pressing
  // play must only play, and next only skip.
  const openUnlessButton = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onOpen();
  };

  return (
    <div data-testid="phone-player-bar" className="flex flex-col">
      <div
        data-testid="phone-player-row"
        onClick={openUnlessButton}
        className="flex cursor-pointer items-center gap-block pl-block pr-block pt-row pb-cluster"
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

        {/* Hit boxes touch: the glyphs' own margins space them. */}
        <div className="flex shrink-0 items-center">
          <BarPlayButton playing={playing} onToggle={onToggle} />
          <Button
            size="icon"
            variant="ghost"
            onClick={onNext}
            aria-label="Next"
            className="size-12 shrink-0 rounded-full text-foreground"
          >
            <NextIcon data-testid="phone-next-glyph" className="size-6 fill-current" />
          </Button>
        </div>
      </div>

      {/* The thin progress slider along the bottom edge: visible, draggable,
          no labels. Outside the row, so dragging it never opens anything. */}
      {/* Lined up with the row above (the owner's "Aligned", then "12px
          left"): the line starts under the artwork (16px in) and ends under
          the next icon. The row keeps 16px on the right and next's 48px hit
          box puts its 24px glyph 12px inside that, so the icon (and the
          line) end 28px from the edge. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="pl-block pr-[28px] -mt-1" />
    </div>
  );
}
