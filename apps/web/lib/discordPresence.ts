'use client';

import { invoke } from '@tauri-apps/api/core';
import { api } from '@/lib/api';
import { detectShell } from '@/lib/playback/detectShell';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import type { Track } from '@/types/track';

/** Publish "now playing" to Discord.
 *
 *  Desktop app → the LOCAL Discord client, so each listener's own profile
 *  shows what they're playing. Everywhere else → the server route, which can
 *  only reach the owner's Discord (browsers have no way to do presence) and
 *  ignores everyone else.
 *  camelCase args are converted to the Rust command's snake_case by Tauri.
 *
 *  The card has a time bar, so the playhead travels with every update: a seek
 *  that is not published leaves the bar pointing at the wrong place. */
export function publishDiscordPresence(
  track: Track | null,
  isPlaying: boolean,
  positionSec = 0,
  durationSec = 0,
): void {
  // Honour the user's Discord switch. The desktop app writes to the LOCAL
  // Discord client, so nothing server-side can stop it — this check is the
  // only thing standing between "hidden" and broadcasting. When sharing is
  // off we still publish a CLEAR, otherwise whatever was showing when they
  // flipped the switch would stay pinned to their profile.
  const { shareDiscord, loaded } = usePrivacyStore.getState();
  if (!shareDiscord) {
    track = null;
    isPlaying = false;
  }

  const position = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;

  if (detectShell() === 'tauri') {
    void invoke('discord_update', {
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      album: track?.album ?? null,
      artworkUrl: track?.artworkUrl ?? null,
      isPlaying,
      positionSec: position,
      durationSec: duration,
    }).catch(() => {});
    return;
  }
  // Signed out (the switches only load with a session): the route needs one,
  // and api.ts answers its 401 by sending the page to /auth, which would
  // bounce a visitor off a public /track page.
  if (!loaded) return;
  void api.updateDiscord(track, isPlaying, position, duration).catch(() => {});
}
