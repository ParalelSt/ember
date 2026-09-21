'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Seek on top". The seek line moves to
 *  the very top edge of the bar, a thin full-width line ahead of the name
 *  row instead of trailing it, then the name row (artwork beside the name,
 *  the same shape as "Art with the name") and the transport row. Built from
 *  the same presentational pieces the shipped bar uses; markup is its own,
 *  no app hooks/stores/network/PlayerProvider, artwork taken as a prop. */
export function SeekOnTopBar({
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
    <div data-testid="phone-player-bar" data-variant="seek-on-top" className="flex flex-col">
      <div data-testid="phone-player-seek-top">
        <SeekBar position={position} duration={duration} onSeek={onSeek} />
      </div>

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
    </div>
  );
}
