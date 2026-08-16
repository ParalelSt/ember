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
 *  only reach the host's Discord (browsers have no way to do presence).
 *  camelCase args are converted to the Rust command's snake_case by Tauri. */
export function publishDiscordPresence(track: Track | null, isPlaying: boolean): void {
  // Honour the user's Discord switch. The desktop app writes to the LOCAL
  // Discord client, so nothing server-side can stop it — this check is the
  // only thing standing between "hidden" and broadcasting. When sharing is
  // off we still publish a CLEAR, otherwise whatever was showing when they
  // flipped the switch would stay pinned to their profile.
  const { shareDiscord } = usePrivacyStore.getState();
  if (!shareDiscord) {
    track = null;
    isPlaying = false;
  }

  if (detectShell() === 'tauri') {
    void invoke('discord_update', {
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      album: track?.album ?? null,
      artworkUrl: track?.artworkUrl ?? null,
      isPlaying,
    }).catch(() => {});
    return;
  }
  void api.updateDiscord(track, isPlaying).catch(() => {});
}
