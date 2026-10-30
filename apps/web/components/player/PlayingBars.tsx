'use client';

import { usePlayerStore } from '@/stores/usePlayerStore';
import { cn } from '@/lib/utils';

/** The small animated bars before the playing song's title in the queue
 *  (owner's pick, Now playing "B. Plain row"). They stop while playback is
 *  paused and stay still under reduced motion (globals.css,
 *  .ember-playing-bar). Its own store read, so a play or pause re-renders
 *  only the bars, not the queue's rows. */
export function PlayingBars({ className }: { className?: string }) {
  const playing = usePlayerStore((s) => s.isPlaying);
  return (
    <span
      data-testid="playing-bars"
      data-playing={playing ? 'true' : 'false'}
      aria-hidden
      className={cn('flex h-3 w-3 shrink-0 items-end justify-between text-ember', className)}
    >
      <span className="ember-playing-bar h-full w-[3px] rounded-[1px] bg-current" />
      <span className="ember-playing-bar h-full w-[3px] rounded-[1px] bg-current" />
      <span className="ember-playing-bar h-full w-[3px] rounded-[1px] bg-current" />
    </span>
  );
}
