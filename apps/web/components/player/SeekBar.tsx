'use client';

import { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Where the two times sit. 'inline' is the player bar's desktop row (elapsed
 *  left of the slider, total right of it), 'below' is the full-screen view
 *  (both under the slider), 'none' is the bare phone strip at the bottom edge
 *  of the bar. A boolean cannot express the two label layouts, which is why
 *  this is a variant rather than `showLabels`. */
export type SeekBarLabels = 'none' | 'inline' | 'below';

export interface SeekBarProps {
  position: number;
  duration: number;
  onSeek: (sec: number) => void;
  labels?: SeekBarLabels;
  className?: string;
}

/** The playback progress slider, with the scrub state it needs. The thumb
 *  follows the finger / cursor on every intermediate value while the audio
 *  keeps playing from `position`; the seek fires once, on release. */
export function SeekBar({ position, duration, onSeek, labels = 'none', className }: SeekBarProps) {
  // Non-null only while a drag is in flight, so the slider snaps back to the
  // real playback position the moment the seek is handed over.
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  const playbackPct = duration ? (position / duration) * 100 : 0;
  const displayPct = scrubPct ?? playbackPct;
  const displaySec = (displayPct / 100) * (duration || 0);

  const readPct = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] ?? 0 : (v as number));

  const onValueChange = (v: number | readonly number[]) => {
    setScrubPct(readPct(v));
  };
  const onValueCommitted = (v: number | readonly number[]) => {
    onSeek((readPct(v) / 100) * (duration || 0));
    setScrubPct(null);
  };

  const slider = (
    <Slider
      value={[displayPct]}
      onValueChange={onValueChange}
      onValueCommitted={onValueCommitted}
      max={100}
      step={0.1}
      smooth
      className={labels === 'inline' ? 'flex-1' : undefined}
    />
  );

  if (labels === 'inline') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">{formatTime(displaySec)}</span>
        {slider}
        <span className="text-[10px] text-muted-foreground tabular-nums w-9">{formatTime(duration)}</span>
      </div>
    );
  }

  if (labels === 'below') {
    return (
      <div className={className}>
        {slider}
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatTime(displaySec)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    );
  }

  return <div className={className}>{slider}</div>;
}
