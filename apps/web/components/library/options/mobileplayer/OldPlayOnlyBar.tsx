'use client';

import { PauseIcon, PlayIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Old + play only". The second of the
 *  two "old shape" candidates the owner asked for: same one-row layout as
 *  "Before" (artwork left, seek line pinned under everything, measured
 *  92px tall in the built gallery: 1px under "Before"'s 93px, because this
 *  one goes through the shared `PLAYER_BAR_CHROME` footer for the
 *  safe-area lift rather than "Before"'s own footer and its 1px border),
 *  but previous, next and queue are gone from the minimised bar entirely.
 *  They still exist in the app; they live on the full-screen NowPlaying
 *  view, same as they always have, reached by tapping the bar (`onOpen`).
 *  What is left in the minimised bar is only the artwork, the scrolling
 *  name and artist, and a single play/pause button.
 *
 *  Removing three controls frees the row's entire horizontal padding and
 *  gaps back up, so this keeps "Before"'s exact spacing tokens
 *  (`px-block`/`gap-block`/`pt-row`/`pb-cluster`, the same px as the old
 *  bar's side padding, gap and row padding, 16px/16px/12px/8px) rather than
 *  tightening anything: the name column still measures 232px at 390 and
 *  202px at 360 in the built gallery, a lot more room than "Old +
 *  scrolling name" gets from tightening alone, so it uses `MarqueeText`
 *  too and will scroll whenever a title actually overflows that box (this
 *  candidate's mock title, "Yes Sir, I Can Boogie", is short enough to fit
 *  and sits still, confirmed in the built gallery; a longer one scrolls
 *  the same way it does on the full-screen view).
 *
 *  Play is raised from the old bar's 40px to 48px (`h-12 w-12`), a size
 *  that still fits inside the row's existing 48px content height (the
 *  artwork's own height), so the bar does not grow a single px taller to
 *  fit it. The cost is 8px of the name column that a 40px button would
 *  have left it. Prev/next and queue are not "shrunk", they are simply not
 *  here: the brief's "keep at least the old ones" floor does not apply to
 *  a control that moved to another view. */
export function OldPlayOnlyBar({
  track,
  playing,
  position,
  duration,
  onToggle,
  onSeek,
  onOpen,
}: ArrangementBarProps) {
  return (
    <div data-testid="phone-player-bar" data-variant="old-play-only" className="flex flex-col">
      <div className="flex items-center gap-block px-block pt-row pb-cluster">
        <div
          data-testid="phone-player-title-row"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-row"
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

        <Button
          size="icon"
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="h-12 w-12 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          {playing ? <PauseIcon className="size-6 fill-current" /> : <PlayIcon className="size-6 fill-current ml-0.5" />}
        </Button>
      </div>

      {/* Same thin progress slider, same place, as "Before" and "Old +
       *  scrolling name". */}
      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row -mt-1" />
    </div>
  );
}
