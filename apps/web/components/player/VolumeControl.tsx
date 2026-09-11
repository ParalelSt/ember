'use client';

import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { VolumeIcon, VolumeMutedIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface VolumeControlProps {
  /** 0 to 1, like the player's own volume. */
  volume: number;
  muted: boolean;
  /** Ceiling of the slider, also 0 to 1 (party mode lifts it to 1). */
  max?: number;
  onChange: (volume: number) => void;
  onToggleMute: () => void;
  className?: string;
  /** Width of the slider box; the caller decides how much room the range
   *  deserves (party mode's longer range gets a longer track). */
  sliderClassName?: string;
}

/** The mute button plus the volume slider. Muting is a toggle rather than a
 *  drag to zero, so the previous level comes back on unmute. */
export function VolumeControl({
  volume,
  muted,
  max = 1,
  onChange,
  onToggleMute,
  className,
  sliderClassName,
}: VolumeControlProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Clickable volume icon toggles mute (also bound to M). When
          muted the icon goes ember + the slider greys + disables. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        title={muted ? 'Unmute (M)' : 'Mute (M)'}
        className={cn(
          'h-8 w-8',
          muted ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {muted
          ? <VolumeMutedIcon className="h-4 w-4" />
          : <VolumeIcon className="h-4 w-4" />}
      </Button>
      <div
        className={cn(
          'shrink-0 transition-opacity',
          sliderClassName,
          muted && 'opacity-40 pointer-events-none',
        )}
      >
        <Slider
          value={[volume * 100]}
          onValueChange={(v) => {
            const pct = Array.isArray(v) ? (v[0] ?? 0) : v;
            onChange(pct / 100);
          }}
          max={max * 100}
          step={1}
          disabled={muted}
          aria-disabled={muted}
        />
      </div>
    </div>
  );
}
