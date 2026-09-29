import type { CastRemoteStatus } from './castBackend';
import type { AudioBackendEvents } from './types';

/** Whether the receiver's loaded URL is this track's signed stream. */
export function isSameSong(contentId: string | null | undefined, track: { source: string; sourceId: string }): boolean {
  if (!contentId) return false;
  let path: string;
  try {
    path = new URL(contentId).pathname;
  } catch {
    return false;
  }
  return track.source === 'upload'
    ? path === `/api/uploads/${track.sourceId}/stream`
    : path === `/api/youtube/stream/${track.sourceId}`;
}

/** Where the song goes on and whether it plays, when the music moves from
 *  this device to a cast device.
 *
 *  A new session takes the song from where it is here, playing if it was
 *  playing. A session the page JOINED (a reload while the TV played on)
 *  follows the TV instead: reloading the page must not pause the room or
 *  send the song back to where the page last saved it. The TV's position
 *  only counts when it is playing the same song. */
export function castHandover(opts: {
  localTime: number;
  localPaused: boolean;
  resumed: boolean;
  remote: CastRemoteStatus | null;
  sameSong?: boolean;
}): { startAt: number; autoplay: boolean } {
  const local = { startAt: Math.max(0, opts.localTime || 0), autoplay: !opts.localPaused };
  if (!opts.resumed || !opts.remote || opts.remote.state === 'idle') return local;
  const playing = opts.remote.state === 'playing' || opts.remote.state === 'buffering';
  return {
    startAt: opts.sameSong ? Math.max(0, opts.remote.time || 0) : local.startAt,
    autoplay: playing,
  };
}

/** And back: casting stopped, so the song waits here, paused, where the TV
 *  left it. Starting out loud on the phone or the laptop the moment the TV
 *  is switched off would be a surprise. */
export function localHandover(castTime: number): { startAt: number; autoplay: false } {
  return { startAt: Math.max(0, Number.isFinite(castTime) ? castTime : 0), autoplay: false };
}

/** [events], passed on only while [live] says so. The engine that is not
 *  playing (the local one while casting, a cast one after the session
 *  ended) can still fire a late pause or error, which must not reach the
 *  player. */
export function gateEvents(events: AudioBackendEvents, live: () => boolean): AudioBackendEvents {
  const out = {} as AudioBackendEvents;
  for (const key of Object.keys(events) as (keyof AudioBackendEvents)[]) {
    const fn = events[key] as ((...a: unknown[]) => void) | undefined;
    if (!fn) continue;
    (out as unknown as Record<string, unknown>)[key] = (...a: unknown[]) => {
      if (live()) fn(...a);
    };
  }
  return out;
}
