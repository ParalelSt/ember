'use client';

import { useEffect } from 'react';
import { publishDiscordPresence } from '@/lib/discordPresence';
import type { Track } from '@/types/track';

/** Discord rich presence. The desktop app talks to the user's OWN Discord;
 *  web/phone falls back to the server route (host's Discord only).
 *
 *  Keyed on the track id and the play/pause flag only, never on the playhead:
 *  the provider re-renders several times a second while audio runs, and
 *  Discord rate-limits presence updates. */
export function useDiscordPresence({
  current,
  isPlaying,
}: {
  current: Track | null;
  isPlaying: boolean;
}) {
  useEffect(() => {
    publishDiscordPresence(current, isPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isPlaying]);
}
