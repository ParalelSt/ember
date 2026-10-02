'use client';

import { useEffect, useState } from 'react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { estimateProgress } from '@/lib/carlist';
import type { SessionState } from '@/types/track';

/** The now-playing bar, 0 to 1 (null: unknown). The host reads its own
 *  player; a guest estimates from the server's elapsed time, ticking once a
 *  second (lib/carlist estimateProgress). */
export function useCarlistProgress(state: SessionState | undefined, fetchedAt: number): number | null {
  const nowItem = state ? state.queue[state.session.nowIndex] : undefined;
  const isHost = !!state?.session.isHost;
  const playerTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const [now, setNow] = useState(() => Date.now());

  const hostKnows = isHost && !!nowItem && playerTrackId === nowItem.track.id && duration > 0;
  const ticking = !!state?.session.active && !!nowItem && !hostKnows;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  if (!state || !nowItem) return null;
  if (hostKnows) return Math.min(1, Math.max(0, position / duration));
  if (!state.session.active) return null;
  return estimateProgress({
    elapsedMs: state.session.nowElapsedMs,
    fetchedAt,
    now: Math.max(now, fetchedAt),
    durationSec: nowItem.track.durationSec,
  });
}
