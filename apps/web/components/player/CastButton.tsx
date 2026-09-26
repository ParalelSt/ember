'use client';

import { Button } from '@/components/ui/button';
import { AirplayIcon, CastIcon } from '@/components/icons';
import { requestCast } from '@/lib/cast/controller';
import { castButtonVisible, useCastStore } from '@/stores/useCastStore';
import { cn } from '@/lib/utils';

/** Play on a Chromecast, Google speaker or Android TV (AirPlay in Safari).
 *  Only on screen when this page can cast and a device is around (or, in a
 *  browser that will not say before the first tap, when it might be). Lit
 *  while casting; tapping it then stops (Chrome) or opens the device's
 *  controls (Android, AirPlay). */
export function CastButton({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const path = useCastStore((s) => s.path);
  const availability = useCastStore((s) => s.availability);
  const connection = useCastStore((s) => s.connection);
  const deviceName = useCastStore((s) => s.deviceName);
  if (!castButtonVisible({ path, availability, connection })) return null;
  const connected = connection === 'connected';
  const label = connected
    ? `Casting to ${deviceName ?? 'a device'}`
    : connection === 'connecting'
      ? 'Connecting to a cast device'
      : path === 'airplay' ? 'AirPlay' : 'Cast';
  const Icon = path === 'airplay' ? AirplayIcon : CastIcon;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void requestCast()}
      aria-label={label}
      aria-pressed={connected}
      title={connected && path !== 'airplay' ? `${label}. The equalizer and volume leveling are off while casting.` : label}
      data-testid="cast-button"
      className={cn(
        connected || connection === 'connecting'
          ? 'text-ember hover:text-ember'
          : 'text-muted-foreground hover:text-foreground',
        connection === 'connecting' && 'animate-pulse',
        className,
      )}
    >
      <Icon className={iconClassName ?? 'h-4 w-4'} />
    </Button>
  );
}

/** "Playing on Living Room TV" under the full-screen player while casting. */
export function CastNote({ className }: { className?: string }) {
  const path = useCastStore((s) => s.path);
  const connection = useCastStore((s) => s.connection);
  const deviceName = useCastStore((s) => s.deviceName);
  if (connection !== 'connected') return null;
  return (
    <p data-testid="cast-note" className={cn('text-xs text-ember text-center', className)}>
      {path === 'airplay'
        ? 'Playing over AirPlay.'
        : `Playing on ${deviceName ?? 'a cast device'}. The equalizer and volume leveling are off while casting.`}
    </p>
  );
}
