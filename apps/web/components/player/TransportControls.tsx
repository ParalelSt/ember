'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** 'sm' is the mini player bar, 'lg' the full-screen view. */
export type TransportSize = 'sm' | 'lg';

const ROW: Record<TransportSize, string> = {
  sm: 'flex items-center gap-3',
  lg: 'relative flex items-center justify-center gap-10',
};

// Prev / next buttons: the bar keeps the Button default box, the full-screen
// view sizes them up.
const STEP_BOX: Record<TransportSize, string | undefined> = {
  sm: undefined,
  lg: 'h-12 w-12',
};

const STEP_ICON: Record<TransportSize, string> = {
  sm: 'h-4 w-4',
  lg: 'h-7 w-7',
};

const PLAY_BOX: Record<TransportSize, string> = {
  sm: 'h-10 w-10',
  lg: 'h-16 w-16',
};

const PLAY_ICON: Record<TransportSize, string> = {
  sm: 'h-4 w-4',
  lg: 'h-7 w-7',
};

export interface TransportControlsProps {
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  size: TransportSize;
  /** Shuffle / loop and friends. The callers own them because they read the
   *  player store, and their labels differ per bar. */
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** Previous / Play-Pause / Next, with slots either side for the toggles each
 *  bar pins next to them. */
export function TransportControls({
  playing,
  onToggle,
  onNext,
  onPrev,
  size,
  left,
  right,
  className,
}: TransportControlsProps) {
  return (
    <div className={cn(ROW[size], className)}>
      {left}
      <Button variant="ghost" size="icon" className={STEP_BOX[size]} onClick={onPrev} aria-label="Previous">
        <PrevIcon className={STEP_ICON[size]} />
      </Button>
      <Button
        size="icon"
        onClick={onToggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={cn(PLAY_BOX[size], 'rounded-full bg-foreground text-background hover:bg-foreground/90')}
      >
        {playing
          ? <PauseIcon className={cn(PLAY_ICON[size], 'fill-current')} />
          : <PlayIcon className={cn(PLAY_ICON[size], 'fill-current ml-0.5')} />}
      </Button>
      <Button variant="ghost" size="icon" className={STEP_BOX[size]} onClick={onNext} aria-label="Next">
        <NextIcon className={STEP_ICON[size]} />
      </Button>
      {right}
    </div>
  );
}
