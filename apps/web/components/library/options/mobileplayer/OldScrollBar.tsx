'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Old + scrolling name". The owner's
 *  ask after seeing "Before" again: keep that exact one-row shape (artwork
 *  left, transport and queue on the right, thin seek line under
 *  everything, the same row padding top and bottom as the old bar), but let
 *  the title scroll the way it already does on the full-screen view, with
 *  `MarqueeText`, instead of truncating. Measured in the built gallery:
 *  92px tall, 1px under "Before"'s 93px, because this one goes through the
 *  shared `PLAYER_BAR_CHROME` footer (for the safe-area lift) rather than
 *  "Before"'s own footer, which draws its own 1px border.
 *
 *  A straight truncate-to-marquee swap inside "Before"'s own layout is
 *  useless: that layout's name column measured only 38px wide at 390 (see
 *  `BEFORE_TITLE_PX`), and a marquee scrolling 2-3 letters at a time is
 *  harder to read than the truncated text it replaces. So this keeps the
 *  old shape but re-fights the same 3-column grid for width: the transport
 *  moves from centred to right-aligned (next to the queue button, not
 *  floating in the middle), and every horizontal gap and the side padding
 *  tighten from the old bar's 16px side padding and 12-16px gaps down to
 *  the `row`/`inset` spacing tokens (12px and 4px). Only the HORIZONTAL
 *  spacing moves; `pt-row`/`pb-cluster` on the row stay the exact px the
 *  old bar used (12px/8px), so the row's own height is unchanged. The freed
 *  width goes entirely to a `1fr` name column, which measures 152px at 390
 *  and 122px at 360 in the built gallery (comfortably over the 150px floor
 *  the brief asked for): still short of "Today"'s 358px name column, but
 *  wide enough that the marquee scrolls whole words at a time instead of
 *  single letters.
 *
 *  Tap targets are the old bar's, unchanged: play 40px, prev/next 32px,
 *  queue 40px (`h-10 w-10`, same as "Before"'s queue button), artwork 48px.
 *  Nothing here was raised; the extra width came entirely from tightening
 *  gaps and padding, not from shrinking any control below what "Before"
 *  already had. */
export function OldScrollBar({
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
}: ArrangementBarProps) {
  return (
    <div data-testid="phone-player-bar" data-variant="old-scroll" className="flex flex-col">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-inset px-row pt-row pb-cluster">
        <div
          data-testid="phone-player-title-row"
          onClick={onOpen}
          className="flex min-w-0 cursor-pointer items-center gap-inset"
        >
          <Artwork
            src={track.artworkUrl}
            size="sm"
            onClick={onOpen}
            className="shrink-0 cursor-pointer rounded-md bg-black"
          />
          <div className="min-w-0 flex-1">
            <MarqueeText text={track.title} className="text-sm font-semibold" />
            <div className="truncate text-xs text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        <div data-testid="phone-player-controls-row" className="flex items-center">
          <TransportControls
            playing={playing}
            onToggle={onToggle}
            onNext={onNext}
            onPrev={onPrev}
            size="sm"
            className="gap-inset"
          />
        </div>

        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground hover:text-foreground"
            onClick={onQueue}
            aria-label="Queue"
            title="Queue"
          >
            <QueueIcon className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Same thin progress slider, in the same place: pulled up with a
       *  negative margin so it sits right on the bottom edge, exactly as
       *  "Before" draws it. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row -mt-1" />
    </div>
  );
}
