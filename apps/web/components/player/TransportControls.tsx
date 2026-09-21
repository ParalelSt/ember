'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** 'sm' is the desktop mini player bar, 'phone' the phone bar (its one play
 *  button, at Android's 48px minimum), 'lg' the full-screen view. */
export type TransportSize = 'sm' | 'phone' | 'lg';

const ROW: Record<TransportSize, string> = {
  sm: 'flex items-center gap-3',
  phone: 'flex items-center gap-cluster',
  lg: 'relative flex items-center justify-center gap-10',
};

// Prev / next buttons: the desktop bar keeps the Button default box, the
// phone bar and the full-screen view size them up.
const STEP_BOX: Record<TransportSize, string | undefined> = {
  sm: undefined,
  phone: 'h-12 w-12',
  lg: 'h-12 w-12',
};

// `size-*` (not `h-* w-*`): Button's own
// `[&_svg:not([class*='size-'])]:size-4` rule outranks a bare h/w pair by
// specificity, so an icon that does not name a `size-` class is pinned to
// 16px however large its box is.
const STEP_ICON: Record<TransportSize, string> = {
  sm: 'h-4 w-4',
  phone: 'size-6',
  lg: 'h-7 w-7',
};

const PLAY_BOX: Record<TransportSize, string> = {
  sm: 'h-10 w-10',
  phone: 'h-12 w-12',
  lg: 'h-16 w-16',
};

const PLAY_ICON: Record<TransportSize, string> = {
  sm: 'h-4 w-4',
  phone: 'size-6',
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

/** The round play/pause button on its own: the middle of TransportControls,
 *  and the only control the phone bar keeps (previous, next and queue live
 *  on the full-screen view there). */
export function PlayPauseButton({
  playing,
  onToggle,
  size,
}: Pick<TransportControlsProps, 'playing' | 'onToggle' | 'size'>) {
  return (
    <Button
      size="icon"
      onClick={onToggle}
      aria-label={playing ? 'Pause' : 'Play'}
      className={cn(
        PLAY_BOX[size],
        // On the phone bar it sits beside a flex-1 name column, which must
        // never squeeze it below 48px.
        size === 'phone' && 'shrink-0',
        'rounded-full bg-foreground text-background hover:bg-foreground/90',
      )}
    >
      {playing
        ? <PauseIcon className={cn(PLAY_ICON[size], 'fill-current')} />
        : <PlayIcon className={cn(PLAY_ICON[size], 'fill-current ml-0.5')} />}
    </Button>
  );
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
      <PlayPauseButton playing={playing} onToggle={onToggle} size={size} />
      <Button variant="ghost" size="icon" className={STEP_BOX[size]} onClick={onNext} aria-label="Next">
        <NextIcon className={STEP_ICON[size]} />
      </Button>
      {right}
    </div>
  );
}
