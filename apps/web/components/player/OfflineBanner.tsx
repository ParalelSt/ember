'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { isAndroidCacheAdapter } from '@/lib/autoCache/androidAdapter';
import { checkServerNow } from '@/lib/playback/serverReach';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { cn } from '@/lib/utils';

export const OFFLINE_PLAYING_TEXT = 'Offline, playing cached songs';
export const OFFLINE_STALLED_TEXT = 'Offline, nothing cached ahead';

/** What the offline state says in full, or null when there is nothing to say
 *  (online). */
export function offlineText(online: boolean, stalled: boolean): string | null {
  if (online) return null;
  return stalled ? OFFLINE_STALLED_TEXT : OFFLINE_PLAYING_TEXT;
}

/** The player's offline state (the auto cache keeps songs playing when the
 *  connection drops; the owner's "Thin banner"): a slim line at the top of
 *  the player's footer. The footer sits at the bottom of the window, so the
 *  line grows it upward and the controls stay where they are. Renders nothing
 *  online.
 *
 *  Try again asks the server right now instead of waiting for the next probe
 *  (lib/playback/serverReach). Nothing playing is touched: the player handles
 *  being back online on its own, loading a stalled song paused
 *  (PlayerProvider). Only the Android player keeps its stalled song to itself,
 *  so there `onResumeStalled` asks it to load that song again. */
export function OfflineBanner({ onResumeStalled }: { onResumeStalled?: () => void }) {
  const online = useAutoCacheStore((s) => s.online);
  const stalled = useAutoCacheStore((s) => s.offlineStalled);
  const [checking, setChecking] = useState(false);
  const text = offlineText(online, stalled);
  if (!text) return null;

  const tryAgain = async () => {
    setChecking(true);
    // Read first: coming back online clears it.
    const before = useAutoCacheStore.getState();
    const resume = before.offlineStalled && isAndroidCacheAdapter(before.adapter);
    const back = await checkServerNow();
    setChecking(false);
    if (!back) toast('Still offline', { duration: 2500 });
    else if (resume) onResumeStalled?.();
  };

  return (
    <div data-testid="offline-banner" className="flex h-8 shrink-0 items-center justify-between gap-row bg-muted px-block text-xs">
      <span
        role="status"
        aria-label={text}
        title={text}
        data-stalled={stalled ? 'true' : 'false'}
        className="flex min-w-0 items-center gap-cluster"
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', stalled ? 'bg-destructive' : 'bg-muted-foreground')} />
        <span className="truncate">You are offline{stalled && <span className="text-muted-foreground">, nothing cached ahead</span>}</span>
      </span>
      {/* The hit box reaches past the slim line upward and sideways, not down
          into the bar's own controls. */}
      <button
        type="button"
        onClick={() => void tryAgain()}
        disabled={checking}
        aria-busy={checking}
        className="relative shrink-0 font-semibold text-foreground before:absolute before:-inset-x-3 before:-top-3 before:-bottom-2 before:content-[''] hover:underline disabled:text-muted-foreground disabled:no-underline"
      >
        Try again
      </button>
    </div>
  );
}
