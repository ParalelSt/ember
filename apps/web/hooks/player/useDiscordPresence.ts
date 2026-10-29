'use client';

import { useEffect, useRef } from 'react';
import { useStationSong } from '@/hooks/player/useStationSong';
import { publishDiscordPresence } from '@/lib/discordPresence';
import { chooseDuration } from '@/lib/playback/chooseDuration';
import { stationSongTrack } from '@/lib/radio/station';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import type { Track } from '@/types/track';

/** How big a jump between two playhead ticks counts as a seek rather than
 *  normal playback. Ticks arrive several times a second, so anything past a
 *  couple of seconds can only be a jump. */
export const SEEK_JUMP_SEC = 2.5;

/** What the card was last told, and the playhead reports it has seen. */
interface Seen {
  mounted: boolean;
  id: string | null;
  isPlaying: boolean;
  /** Last playhead that belongs to `id`. Right after a song change this is
   *  0, the new song's start, whatever the render still said. */
  sec: number;
  /** The previous song's last playhead, until the new song's own clock has
   *  reported. A report near it (and not near `sec`) is the old song's. */
  leftover: number | null;
}

/** Discord rich presence. The desktop app talks to the user's OWN Discord;
 *  web/phone falls back to the server route (host's Discord only).
 *
 *  Publishes on a track change, on play/pause, and on a seek. Never on a
 *  normal playhead tick: the provider re-renders several times a second
 *  while audio runs, and Discord rate-limits presence updates. Seeks come
 *  from many places (slider, arrow keys, media keys, a bar clicked in the tab
 *  viewer), so rather than hooking each one this watches the playhead itself.
 *
 *  A different song always starts at 0:00 (see lib/playback/resumePosition),
 *  so a track change is published at 0 with the new song's own length. The
 *  playhead in the render that changes the song cannot be trusted: it is
 *  only reset in the same turn when the web player loads the song itself,
 *  while a change the provider loads from an effect, or one the native
 *  Android player reports, still carries the previous song's position (and
 *  length). Publishing it put the new song on the card at 2:45, and nothing
 *  corrected it, since the new song's first tick did not look like a seek.
 *
 *  A live station is shown like a song once its stream names the one on
 *  (useStationSong): the song and artist, the station's name where the album
 *  goes. A new song on the same station is published as it is heard. */
export function useDiscordPresence({
  current: track,
  isPlaying,
  position,
  duration,
}: {
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
}) {
  const song = useStationSong(track, isPlaying);
  // What the card shows: the track itself, or a station as its song.
  const current = stationSongTrack(track, song);
  const seen = useRef<Seen>({ mounted: false, id: null, isPlaying: false, sec: 0, leftover: null });

  // duration is read from the closure but deliberately left out of the
  // dependency list: the card only needs to change when the song, the
  // play/pause state or the playhead does.
  useEffect(() => {
    const s = seen.current;
    const id = current?.id ?? null;

    if (!s.mounted || id !== s.id) {
      // From one song to another: the new one starts at the top. From
      // nothing (first mount, a cold start, an emptied queue refilled), the
      // stored playhead is the song's own and is where it resumes.
      const fromSong = s.mounted && s.id !== null && id !== null;
      const sec = fromSong ? 0 : position;
      const dur = fromSong ? chooseDuration(current?.durationSec ?? 0, null) : duration;
      seen.current = {
        mounted: true,
        id,
        isPlaying,
        sec,
        leftover: fromSong ? s.sec : null,
      };
      publishDiscordPresence(current, isPlaying, sec, dur);
      return;
    }

    const near = (a: number, b: number) => Math.abs(a - b) <= SEEK_JUMP_SEC;
    // A report of the previous song's clock, not this song's: ignore it.
    const leftover = s.leftover !== null && !near(position, s.sec) && near(position, s.leftover);

    if (isPlaying !== s.isPlaying) {
      s.isPlaying = isPlaying;
      if (!leftover) s.sec = position;
      // Until the new song's clock has reported, the render's length may be
      // the previous song's too, like its playhead: the song's own stands in.
      const length = s.leftover !== null ? chooseDuration(current?.durationSec ?? 0, null) : duration;
      publishDiscordPresence(current, isPlaying, s.sec, length);
      return;
    }

    if (leftover) return;
    // The song's own clock has reported: from here on, only a jump counts.
    s.leftover = null;
    const jumped = !near(position, s.sec);
    s.sec = position;
    if (jumped && isPlaying) publishDiscordPresence(current, true, position, duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isPlaying, position]);

  // The Discord switch: publishDiscordPresence reads it on every call, but a
  // change (the settings landing after the first publish, or the member
  // flipping it mid-song) would otherwise wait for the next song, pause or
  // seek. Republish what is on now, at the last playhead this song reported.
  const shareDiscord = usePrivacyStore((st) => st.shareDiscord);
  const lastShare = useRef(shareDiscord);
  useEffect(() => {
    if (lastShare.current === shareDiscord) return;
    lastShare.current = shareDiscord;
    const s = seen.current;
    if (!s.mounted) return;
    const length = s.leftover !== null ? chooseDuration(current?.durationSec ?? 0, null) : duration;
    publishDiscordPresence(current, isPlaying, s.sec, length);
    // Only the switch: the song, play state and playhead have their own
    // publishes above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareDiscord]);

  // The station's song changed (or was first heard, or is no longer named):
  // republish at the last playhead. A different station is published by the
  // track change above, so only a change on the same one counts here.
  const songKey = song ? `${song.artist ?? ''}\n${song.title}` : '';
  const lastSong = useRef({ id: track?.id ?? null, key: songKey });
  useEffect(() => {
    const id = track?.id ?? null;
    const before = lastSong.current;
    lastSong.current = { id, key: songKey };
    if (before.id !== id || before.key === songKey) return;
    const s = seen.current;
    if (!s.mounted || !isPlaying) return;
    publishDiscordPresence(current, true, s.sec, duration);
    // Only the song: the rest have their own publishes above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songKey, track?.id]);
}
