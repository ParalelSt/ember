'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Art with the name" (the Recommended
 *  candidate). Artwork moves up beside the title and artist, one row, so it
 *  reads as belonging to the name instead of sitting stranded under it; the
 *  transport row is below, centred on the bar the same [1fr auto 1fr] way
 *  the shipped bar centres it; the seek line is under that. Built from the
 *  same presentational pieces the shipped bar uses (MarqueeText, SeekBar,
 *  TransportControls, Artwork) so it reads and behaves the same, but the
 *  markup here is its own: no app hooks, stores, network or PlayerProvider,
 *  `track.artworkUrl` taken as a prop rather than through `useTrackArtSrc`. */
export function ArtWithNameBar({
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
    <div data-testid="phone-player-bar" data-variant="art-with-name" className="flex flex-col">
      <div className="flex flex-col gap-cluster px-block pt-cluster pb-inset">
        <div
          data-testid="phone-player-title-row"
          onClick={onOpen}
          className="flex min-w-0 cursor-pointer items-center gap-row"
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

        <div data-testid="phone-player-controls-row" className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div />
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

      <SeekBar position={position} duration={duration} onSeek={onSeek} className="px-row pb-inset" />
    </div>
  );
}
