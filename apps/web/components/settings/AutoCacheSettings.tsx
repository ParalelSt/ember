'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { formatBytes, formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

export const AUTO_CACHE_UNAVAILABLE_TEXT = 'Automatic caching is not available in this browser or app version.';

/** One switch row, the same shape as the other settings switches. */
function SwitchRow({
  name,
  description,
  on,
  disabled,
  onToggle,
}: {
  name: string;
  description: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-block rounded-2xl bg-card p-block shadow-soft">
      <div className="min-w-0">
        <div className="font-semibold">{name}</div>
        <p className="mt-inset text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={on ? `Turn off ${name}` : `Turn on ${name}`}
        className={cn(
          'shrink-0 relative h-6 w-11 rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform',
            on ? 'translate-x-5 bg-ember-foreground' : 'bg-foreground',
          )}
        />
      </button>
    </div>
  );
}

/** Settings > Downloads: the automatic cache of upcoming songs
 *  (hooks/player/useAutoCache). Both switches are per device. Plain on
 *  purpose; the design can be picked later. */
export function AutoCacheSettings() {
  const enabled = useSettingsStore((s) => s.autoCacheEnabled);
  const setEnabled = useSettingsStore((s) => s.setAutoCacheEnabled);
  const onMetered = useSettingsStore((s) => s.autoCacheOnMetered);
  const setOnMetered = useSettingsStore((s) => s.setAutoCacheOnMetered);
  const supported = useAutoCacheStore((s) => s.supported);
  const stats = useAutoCacheStore((s) => s.stats);
  const clear = useAutoCacheStore((s) => s.clear);
  const [clearing, setClearing] = useState(false);

  const onClear = async () => {
    setClearing(true);
    try {
      await clear();
      toast.success('Cached songs cleared');
    } catch (e) {
      toast.error(`Couldn't clear: ${(e as Error).message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-row" data-testid="auto-cache-settings">
      <SwitchRow
        name="Cache upcoming songs"
        description="Quietly saves the song you are playing and the next two on this device, so the music keeps going if the connection drops."
        on={enabled}
        disabled={!supported}
        onToggle={() => setEnabled(!enabled)}
      />
      <SwitchRow
        name="Also on mobile data"
        description="Off: caching waits until you are on Wi-Fi."
        on={onMetered}
        disabled={!supported || !enabled}
        onToggle={() => setOnMetered(!onMetered)}
      />
      {supported ? (
        <div className="flex items-center justify-between gap-block rounded-2xl bg-card px-block py-row shadow-soft">
          <span className="text-sm text-muted-foreground tabular-nums" data-testid="auto-cache-stats">
            Cached: {formatBytes(stats.bytes)}, {formatCount(stats.count, 'song')}
          </span>
          <Button variant="outline" size="sm" onClick={onClear} disabled={clearing || stats.count === 0}>
            Clear cached songs
          </Button>
        </div>
      ) : (
        <p className="text-meta" data-testid="auto-cache-unavailable">{AUTO_CACHE_UNAVAILABLE_TEXT}</p>
      )}
    </div>
  );
}
