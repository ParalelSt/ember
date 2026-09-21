'use client';

import type { MouseEvent } from 'react';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { PlayPauseButton } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import { useTrackArtSrc } from '@/lib/offlineNative';
import type { Track } from '@/types/track';

/** The player bar's chrome: the strip's own background, its top border and
 *  the safe-area stand-off that keeps it clear of Android's system
 *  navigation. On the <footer> rather than on either layout inside it, so
 *  the two cannot disagree, and shared with the design gallery's preview so
 *  that cannot drift either. */
export const PLAYER_BAR_CHROME =
  'shrink-0 bg-sidebar border-t border-sidebar-border flex flex-col safe-area-bottom';

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
 * needs. Artwork, the song name and artist (scrolling with MarqueeText when
 * the name overflows), and one 48px play/pause button; the thin seek line
 * under all of it, where the old bar had it. Previous, next and the queue
 * are not here: they live on the full-screen NowPlaying view, which a tap
 * on the bar opens. With those gone the name gets about 232px at a 390px
 * phone (202px at 360) instead of the old bar's 38px.
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
          <Artwork src={artSrc} size="sm" className="shrink-0 rounded-md bg-black" />
          {/* min-w-0 flex-1: the marquee's box is sized by the row, never by
              the title inside it, which is what keeps measuring it stable. */}
          <div className="min-w-0 flex-1">
            <MarqueeText text={track.title} className="text-sm font-semibold" />
            <div className="truncate text-xs text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        <PlayPauseButton playing={playing} onToggle={onToggle} size="phone" />
      </div>

      {/* The thin progress slider along the bottom edge: visible, draggable,
          no labels. Outside the row, so dragging it never opens anything. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row -mt-1" />
    </div>
  );
}
