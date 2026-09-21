'use client';

import { Button } from '@/components/ui/button';
import { QueueIcon } from '@/components/icons';
import { MarqueeText } from '@/components/player/MarqueeText';
import { SeekBar } from '@/components/player/SeekBar';
import { TransportControls } from '@/components/player/TransportControls';
import { Artwork } from '@/components/primitives/Artwork';
import type { ArrangementBarProps } from '@/components/library/options/mobileplayer';

/** GALLERY MOCK, not the shipped bar: "Art spans both rows". A larger
 *  artwork on the left stretches (`self-stretch`) to the full height of the
 *  name-row-plus-transport-row column beside it, rather than sitting at a
 *  fixed 48px the way the other candidates keep it; the name row and the
 *  transport row stack in the column to its right. Built from the same
 *  presentational pieces the shipped bar uses; markup is its own, no app
 *  hooks/stores/network/PlayerProvider, artwork taken as a prop. */
export function ArtSpansBothBar({
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
    <div data-testid="phone-player-bar" data-variant="art-spans-both" className="flex flex-col">
      <div className="flex items-stretch gap-row px-block pt-cluster pb-inset">
        <Artwork
          src={track.artworkUrl}
          onClick={onOpen}
          className="w-20 shrink-0 cursor-pointer self-stretch rounded-md bg-black"
        />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-cluster">
          <div data-testid="phone-player-title-row" onClick={onOpen} className="min-w-0 cursor-pointer">
            <MarqueeText text={track.title} className="text-sm font-semibold" />
            <div className="truncate text-xs text-muted-foreground" title={track.artist}>
              {track.artist}
            </div>
          </div>

          <div data-testid="phone-player-controls-row" className="flex items-center justify-between gap-cluster">
            <TransportControls
              playing={playing}
              onToggle={onToggle}
              onNext={onNext}
              onPrev={onPrev}
              size="phone"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 shrink-0 text-muted-foreground hover:text-foreground"
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
