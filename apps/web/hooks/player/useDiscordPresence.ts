'use client';

import { useEffect, useRef } from 'react';
import { publishDiscordPresence } from '@/lib/discordPresence';
import type { Track } from '@/types/track';

/** How big a jump between two playhead ticks counts as a seek rather than
 *  normal playback. Ticks arrive several times a second, so anything past a
 *  couple of seconds can only be a jump. */
export const SEEK_JUMP_SEC = 2.5;

/** Discord rich presence. The desktop app talks to the user's OWN Discord;
 *  web/phone falls back to the server route (host's Discord only).
 *
 *  Two publishes, deliberately kept apart:
 *
 *  - Track change and play/pause, keyed on the track id and the flag only,
 *    never on the playhead: the provider re-renders several times a second
 *    while audio runs, and Discord rate-limits presence updates.
 *  - A seek. The card carries a time bar, so a jump that is not published
 *    leaves the bar pointing at the wrong place. Seeks come from many places
 *    (slider, arrow keys, media keys, a bar clicked in the tab viewer), so
 *    rather than hooking each one this watches the playhead itself. */
export function useDiscordPresence({
  current,
  isPlaying,
  position,
  duration,
}: {
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
}) {
  // position/duration are read from the closure but deliberately left out of
  // the dependency list: the effect only needs to FIRE on a track or
  // play/pause change, and when it does it already holds that render's
  // playhead.
  useEffect(() => {
    publishDiscordPresence(current, isPlaying, position, duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isPlaying]);

  const lastPositionRef = useRef<{ id: string | null; sec: number }>({ id: null, sec: 0 });
  useEffect(() => {
    const last = lastPositionRef.current;
    const id = current?.id ?? null;
    const jumped = last.id === id && Math.abs(position - last.sec) > SEEK_JUMP_SEC;
    lastPositionRef.current = { id, sec: position };
    if (jumped && isPlaying) publishDiscordPresence(current, true, position, duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
}
