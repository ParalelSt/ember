'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePrankInbox, type PrankReceipt } from '@/hooks/pranks/usePrankInbox';
import { usePresenceHeartbeat } from '@/hooks/pranks/usePresenceHeartbeat';
import { apiUrl } from '@/lib/api';
import { decidePrank } from '@/lib/pranks/decide';
import { PRANK_LIMITS } from '@/lib/pranks/limits';
import { overlayLevel } from '@/lib/pranks/mix';
import { createOverlayPlayer, type OverlayPlayer } from '@/lib/pranks/overlayPlayer';
import type { PrankAck, PrankEngine, PrankRow } from '@/lib/pranks/types';
import type { AudioBackend } from '@/lib/playback/types';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/** Turns an incoming prank into what the player does, and reports back.
 *  Renders nothing and never shows anything: the person on the receiving end
 *  is never told (owner decision). Only pings and sounds exist; a song-swap
 *  kind was planned then dropped before it shipped. A sound plays through a
 *  second audio element (see overlayPlayer) with the music ducked through
 *  `onDuck`; on the native Android engine the app plays and ducks it itself
 *  (backend playOverlay), and an app build too old for that acks it as
 *  unsupported. */
export function PrankReceiver({
  backendRef,
  engineRef,
  onDuck,
  makeOverlay = createOverlayPlayer,
}: {
  backendRef: RefObject<AudioBackend | null>;
  engineRef: RefObject<PrankEngine>;
  /** Music level multiplier while a sound plays (1 = none). */
  onDuck: (level: number) => void;
  makeOverlay?: () => OverlayPlayer;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = usePlayerStore((s) => s.queue[s.index] ?? null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const party = useSettingsStore((s) => s.partyVolume);

  const overlayRef = useRef<OverlayPlayer | null>(null);
  /** The admin's share of the person's volume for the sound playing now. */
  const shareRef = useRef<number | null>(null);
  const onDuckRef = useRef(onDuck);
  useEffect(() => {
    onDuckRef.current = onDuck;
  }, [onDuck]);
  const makeOverlayRef = useRef(makeOverlay);
  /** A sound is playing through the native Android overlay. */
  const nativeBusyRef = useRef(false);

  const playSound = useCallback(
    async (url: string, share: number, duck: boolean, base: Partial<PrankAck>): Promise<PrankAck | PrankReceipt> => {
      const overlay = (overlayRef.current ??= makeOverlayRef.current());
      const st = usePlayerStore.getState();
      const handle = overlay.play(apiUrl(url), {
        volume: overlayLevel(share, st.volume, st.muted, useSettingsStore.getState().partyVolume),
        maxSec: PRANK_LIMITS.soundMaxSec,
      });
      shareRef.current = share;
      const settle = handle.finished.then((r) => {
        shareRef.current = null;
        if (duck) onDuckRef.current(1);
        return r;
      });
      if (!(await handle.started)) {
        await settle;
        return { status: 'skipped', reason: 'error:load', ...base };
      }
      if (duck) onDuckRef.current(PRANK_LIMITS.duck);
      return {
        ack: { status: 'delivered', ...base },
        then: settle.then((r): PrankAck => ({ status: 'done', playedSec: r.playedSec })),
      };
    },
    [],
  );

  /** Same acks as playSound; native keeps the sound relative to the music's
   *  level and does the duck and its restore, so onDuck stays out of it. */
  const playNative = useCallback(
    async (b: AudioBackend, url: string, share: number, duck: boolean, base: Partial<PrankAck>): Promise<PrankAck | PrankReceipt> => {
      const handle = b.playOverlay!(url, {
        volume: share,
        duckTo: duck ? PRANK_LIMITS.duck : 1,
        maxSec: PRANK_LIMITS.soundMaxSec,
      });
      nativeBusyRef.current = true;
      const settle = handle.finished.then((r) => {
        nativeBusyRef.current = false;
        return r;
      });
      if (!(await handle.started)) {
        await settle;
        return { status: 'skipped', reason: 'error:load', ...base };
      }
      return {
        ack: { status: 'delivered', ...base },
        then: settle.then((r): PrankAck => ({ status: 'done', playedSec: r.playedSec })),
      };
    },
    [],
  );

  const receive = useCallback(
    (row: PrankRow): PrankAck | Promise<PrankAck | PrankReceipt> | null => {
      const st = usePlayerStore.getState();
      const b = backendRef.current;
      const engine = engineRef.current;
      const native = engine === 'android' && typeof b?.playOverlay === 'function';
      const action = decidePrank(row, {
        isPlaying: st.isPlaying && !!b && !b.isPaused(),
        hasTrack: !!st.queue[st.index],
        engine,
        busy: nativeBusyRef.current || (overlayRef.current?.busy() ?? false),
        pluginHasOverlay: native,
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
        case 'sound':
          // Native resolves the relative URL against its own server base.
          return native
            ? playNative(b!, action.url, action.volume, action.duck, base)
            : playSound(action.url, action.volume, action.duck, base);
        default:
          return { status: 'skipped', reason: 'engine-unsupported', ...base };
      }
    },
    [backendRef, engineRef, playSound, playNative],
  );

  // Pausing the music ends the sound too (and with it the duck).
  useEffect(() => {
    if (isPlaying) return;
    overlayRef.current?.stop();
    // Native already stops on pause; this covers a pause it never saw.
    if (nativeBusyRef.current) backendRef.current?.stopOverlay?.();
  }, [isPlaying, backendRef]);

  // The sound follows the person's own volume, mute and party mode.
  useEffect(() => {
    const share = shareRef.current;
    if (share !== null) overlayRef.current?.setVolume(overlayLevel(share, volume, muted, party));
  }, [volume, muted, party]);

  useEffect(
    () => () => {
      overlayRef.current?.destroy();
      overlayRef.current = null;
    },
    [],
  );

  usePrankInbox({ userId, isPlaying, receive });
  usePresenceHeartbeat({ userId, current, isPlaying, engineRef });
  return null;
}
