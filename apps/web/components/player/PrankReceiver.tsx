'use client';

import { useCallback, type RefObject } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePrankInbox } from '@/hooks/pranks/usePrankInbox';
import { usePresenceHeartbeat } from '@/hooks/pranks/usePresenceHeartbeat';
import { decidePrank } from '@/lib/pranks/decide';
import type { PrankAck, PrankEngine, PrankRow } from '@/lib/pranks/types';
import type { AudioBackend } from '@/lib/playback/types';
import { usePlayerStore } from '@/stores/usePlayerStore';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/** Turns an incoming prank into what the player does, and reports back.
 *  Renders nothing and never shows anything: the person on the receiving end
 *  is never told (owner decision). Only `ping` is handled so far; sounds and
 *  swaps arrive in later tasks and are acknowledged as unsupported until then. */
export function PrankReceiver({
  backendRef,
  engineRef,
}: {
  backendRef: RefObject<AudioBackend | null>;
  engineRef: RefObject<PrankEngine>;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const receive = useCallback(
    (row: PrankRow): PrankAck | null => {
      const st = usePlayerStore.getState();
      const b = backendRef.current;
      const engine = engineRef.current;
      const action = decidePrank(row, {
        isPlaying: st.isPlaying && !!b && !b.isPaused(),
        hasTrack: !!st.queue[st.index],
        position: st.position,
        engine,
        busy: false,
        pluginHasSwap: false,
        pluginHasOverlay: false,
        now: Date.now(),
      });
      const base = { engine, appVersion: APP_VERSION };
      switch (action.type) {
        case 'ignore':
          return null;
        case 'ack-only':
          return { status: 'delivered', ...base };
        case 'skip':
          return { status: 'skipped', reason: action.reason, ...base };
        default:
          return { status: 'skipped', reason: 'engine-unsupported', ...base };
      }
    },
    [backendRef, engineRef],
  );

  usePrankInbox({ userId, isPlaying, receive });
  usePresenceHeartbeat({ userId, current, isPlaying, engineRef });
  return null;
}
