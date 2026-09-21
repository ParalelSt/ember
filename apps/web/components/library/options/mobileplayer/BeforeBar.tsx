'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Before", the phone bar as it was
 *  before the two-row change (commit 97a0269^, `PlayerBar.tsx` prior to
 *  `PhonePlayerBar.tsx` existing). One [1fr auto 1fr] row: artwork + the
 *  truncated title/artist on the left, the transport centred, the queue
 *  button right, exactly as `PlayerBar` drew it on a phone (it used the
 *  same component for every width; `md:` classes only added the desktop
 *  extras). The old title box had no marquee, just a `truncate`, because
 *  it never had the room to make one worthwhile.
 *
 *  Deliberately its own <footer>, not wrapped in the shared
 *  `PLAYER_BAR_CHROME` the other candidates use: the old bar's chrome was
 *  `paddingBottom: env(safe-area-inset-bottom, 0px)`, not the
 *  `safe-area-bottom` class the current bar and nav share. That inline
 *  style is left out here on purpose rather than copied: `env()` reported
 *  nothing on the targeted WebView, so it always resolved to its `0px`
 *  fallback there, same as leaving it out entirely, and the codebase now
 *  has exactly one place (`app/globals.css`) allowed to hold a
 *  `safe-area-inset-*` string (see `lib/lintRules.test.ts`). Either way the
 *  visible result is identical: the bar does NOT lift above Android's
 *  system navigation, which was the bug the owner hit. Not wrapping this
 *  in `PLAYER_BAR_CHROME` (and so not getting `safe-area-bottom`) is what
 *  shows that honestly, including the strip sitting over the bar in the
 *  Android frames below. */
export function BeforeBar({
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
    <footer
      data-testid="player-bar"
      data-variant="before"
      className="shrink-0 bg-sidebar border-t border-sidebar-border flex flex-col"
    >
      <div
        data-testid="phone-player-bar"
        data-variant="before"
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pt-3 pb-2"
      >
        <div
          data-testid="phone-player-title-row"
          onClick={onOpen}
          className="flex min-w-0 cursor-pointer items-center gap-3"
        >
          <Artwork
            src={track.artworkUrl}
            size="sm"
            onClick={onOpen}
            className="shrink-0 cursor-pointer rounded-md bg-black"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" title={track.title}>
              {track.title}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>
        </div>

        <div data-testid="phone-player-controls-row" className="flex items-center gap-3">
          <TransportControls playing={playing} onToggle={onToggle} onNext={onNext} onPrev={onPrev} size="sm" />
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

      {/* The old thin progress slider: outside the padded row, pulled up
       *  with a negative margin so it sits right on the bottom edge. */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-3 -mt-1" />
    </footer>
  );
}
