'use client';

import type { MouseEvent } from 'react';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { PlayPauseButton } from '@/components/player/TransportControls';
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

/** The bar's size presets, on trial in the /dizajn gallery. `today` is what
 *  ships and the default, so the live bar keeps its sizes until the owner
 *  picks another one. */
export type PhoneBarSize = 'today' | 'balanced' | 'art' | 'compact';

/** How the play/pause button is drawn: today's solid white disc, or the
 *  bare glyph in the text colour. Either way the hit box is the same. */
export type PhonePlayStyle = 'disc' | 'icon';

export interface PhoneBarSizeSpec {
  /** Row padding above and below the artwork and the play button. */
  row: string;
  /** Artwork box. */
  art: string;
  title: string;
  artist: string;
  /** The play button's hit box (what a finger presses). */
  hit: string;
  /** The visible disc inside it, in the disc style. */
  disc: string;
  /** The glyph inside the disc. */
  discIcon: string;
  /** The glyph on its own, in the icon style: larger than inside a disc,
   *  since it has to carry the weight the disc did. */
  bareIcon: string;
}

export const PHONE_BAR_SIZES: Record<PhoneBarSize, PhoneBarSizeSpec> = {
  // Exactly what ships: the button IS the 48px disc (PlayPauseButton
  // 'phone'), so disc and hit are the same box.
  today: {
    row: 'pt-row pb-cluster',
    art: 'size-art-sm',
    title: 'text-sm font-semibold',
    artist: 'text-xs',
    hit: 'size-12',
    disc: 'size-12',
    discIcon: 'size-6',
    bareIcon: 'size-7',
  },
  balanced: {
    row: 'pt-row pb-cluster',
    art: 'size-art-bar',
    title: 'text-base font-semibold',
    artist: 'text-sm',
    hit: 'size-12',
    disc: 'size-10',
    discIcon: 'size-5',
    bareIcon: 'size-7',
  },
  art: {
    row: 'pt-cluster pb-cluster',
    art: 'size-art-bar-lg',
    title: 'text-base font-semibold',
    artist: 'text-sm',
    hit: 'size-12',
    disc: 'size-11',
    discIcon: 'size-5',
    bareIcon: 'size-7',
  },
  compact: {
    row: 'pt-cluster pb-inset',
    art: 'size-art-sm',
    title: 'text-base font-semibold',
    artist: 'text-sm',
    hit: 'size-12',
    disc: 'size-10',
    discIcon: 'size-5',
    bareIcon: 'size-7',
  },
};

/** Play/pause for the size presets: a hit box that can be larger than what
 *  is drawn inside it, so the disc can shrink without the tap target doing
 *  the same. */
function BarPlayButton({
  playing,
  onToggle,
  spec,
  playStyle,
}: {
  playing: boolean;
  onToggle: () => void;
  spec: PhoneBarSizeSpec;
  playStyle: PhonePlayStyle;
}) {
  const Glyph = playing ? PauseIcon : PlayIcon;
  const glyph = (size: string) => (
    // The play triangle's weight sits left of its box: nudge it to centre.
    <Glyph className={cn(size, 'fill-current', !playing && 'translate-x-0.5')} />
  );
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onToggle}
      aria-label={playing ? 'Pause' : 'Play'}
      data-play-style={playStyle}
      className={cn(spec.hit, 'shrink-0 rounded-full text-foreground')}
    >
      {playStyle === 'disc' ? (
        <span
          data-testid="phone-play-disc"
          className={cn(spec.disc, 'flex items-center justify-center rounded-full bg-foreground text-background')}
        >
          {glyph(spec.discIcon)}
        </span>
      ) : (
        glyph(spec.bareIcon)
      )}
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
  /** Size preset; defaults to what ships ('today'). */
  size?: PhoneBarSize;
  /** Play button look; defaults to what ships ('disc'). */
  playStyle?: PhonePlayStyle;
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
  size = 'today',
  playStyle = 'disc',
}: PhonePlayerBarProps) {
  const spec = PHONE_BAR_SIZES[size];
  // Today's disc is the shared PlayPauseButton, untouched, so the default
  // renders exactly what shipped before the presets existed.
  const shipped = size === 'today' && playStyle === 'disc';
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
    <div data-testid="phone-player-bar" data-size={size} data-play-style={playStyle} className="flex flex-col">
      <div
        data-testid="phone-player-row"
        onClick={openUnlessButton}
        className={cn('flex cursor-pointer items-center gap-block px-block', spec.row)}
      >
        <div data-testid="phone-player-title-row" className="flex min-w-0 flex-1 items-center gap-row">
          <Artwork src={artSrc} className={cn(spec.art, 'shrink-0 rounded-md bg-black')} />
          {/* min-w-0 flex-1: the marquee's box is sized by the row, never by
              the title inside it, which is what keeps measuring it stable. */}
          <div className="min-w-0 flex-1">
            <MarqueeText text={track.title} className={spec.title} />
            <div className={cn('truncate', spec.artist, 'text-muted-foreground')} title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        {shipped ? (
          <PlayPauseButton playing={playing} onToggle={onToggle} size="phone" />
        ) : (
          <BarPlayButton playing={playing} onToggle={onToggle} spec={spec} playStyle={playStyle} />
        )}
      </div>

      {/* The thin progress slider along the bottom edge: visible, draggable,
          no labels. Outside the row, so dragging it never opens anything. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row -mt-1" />
    </div>
  );
}
