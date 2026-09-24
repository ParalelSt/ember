'use client';

import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { cn } from '@/lib/utils';

export const OFFLINE_PLAYING_TEXT = 'Offline, playing cached songs';
export const OFFLINE_STALLED_TEXT = 'Offline, nothing cached ahead';

/** What the offline badge says, or null when there is nothing to say (online). */
export function offlineBadgeText(online: boolean, stalled: boolean): string | null {
  if (online) return null;
  return stalled ? OFFLINE_STALLED_TEXT : OFFLINE_PLAYING_TEXT;
}

/** The player's offline state (the auto cache keeps songs playing when the
 *  connection drops). In the desktop bar, a small "Offline" pill beside the
 *  song, short so the song keeps its room, with the whole state in its label
 *  and tooltip; in the phone bar, `inline` sets the whole sentence as a plain
 *  line in place of the artist, so the bar keeps its height. Renders nothing
 *  online. Deliberately plain so it can be restyled once a design is picked. */
export function OfflineBadge({ inline = false, className }: { inline?: boolean; className?: string }) {
  const online = useAutoCacheStore((s) => s.online);
  const stalled = useAutoCacheStore((s) => s.offlineStalled);
  const text = offlineBadgeText(online, stalled);
  if (!text) return null;

  return (
    <span
      role="status"
      aria-label={text}
      title={text}
      data-testid="offline-badge"
      data-stalled={stalled ? 'true' : 'false'}
      className={cn(
        'inline-flex min-w-0 items-center gap-inset text-muted-foreground',
        inline ? 'text-sm' : 'shrink-0 rounded-full bg-muted px-cluster py-inset text-xs',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', stalled ? 'bg-destructive' : 'bg-muted-foreground')} />
      <span className="truncate">{inline ? text : 'Offline'}</span>
    </span>
  );
}
