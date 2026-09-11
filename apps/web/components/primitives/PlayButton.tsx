import type { MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { PauseIcon, PlayIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

export type PlayButtonSize = 'sm' | 'md' | 'lg';

const BOX: Record<PlayButtonSize, string> = {
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-14 w-14',
};

const ICON: Record<PlayButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

// A play triangle looks off-centre in a circle, so the bigger buttons nudge
// it right. Pause is symmetric and never moves.
const NUDGE: Record<PlayButtonSize, string> = {
  sm: '',
  md: 'ml-0.5',
  lg: 'ml-0.5',
};

export interface PlayButtonProps {
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  size?: PlayButtonSize;
  /** aria-label; defaults to 'Play' / 'Pause' from `playing`. */
  label?: string;
  playing?: boolean;
  className?: string;
}

/** Presentational only: the round ember play button used on every page that
 *  starts playback. */
export function PlayButton({
  onClick,
  disabled,
  size = 'md',
  label,
  playing = false,
  className,
}: PlayButtonProps) {
  const Icon = playing ? PauseIcon : PlayIcon;
  return (
    <Button
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ?? (playing ? 'Pause' : 'Play')}
      className={cn(
        'rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow',
        BOX[size],
        className,
      )}
    >
      <Icon className={cn(ICON[size], 'fill-current', !playing && NUDGE[size])} />
    </Button>
  );
}
