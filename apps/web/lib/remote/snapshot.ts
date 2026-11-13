import type { LoopMode } from '@/stores/usePlayerStore';
import type { PlaybackContext, Track } from '@/types/track';
import { UP_NEXT_MAX, type FullState, type LightState } from './types';

/** The player's state as it goes to the server: built from the player
 *  store, with a hash that says "same queue" without sending it. */

export interface PlayerStateLike {
  queue: Track[];
  index: number;
  position: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  loopMode: LoopMode;
  shuffle: boolean;
  context: PlaybackContext | null;
}

/** FNV-1a over the queue's song ids, in order: the same songs in the same
 *  order give the same hash whatever the playhead does. */
export function queueHash(queue: readonly Pick<Track, 'id'>[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const t of queue) {
    feed(t.id);
    feed('\u0000');
  }
  return `${queue.length.toString(36)}-${h.toString(36)}`;
}

/** Only the Track fields: the queue's own marks (`queued`) stay here. */
function plainTrack(t: Track): Track {
  const out: Track = {
    id: t.id, source: t.source, sourceId: t.sourceId, title: t.title, artist: t.artist,
    artistId: t.artistId ?? null, album: t.album ?? null, albumId: t.albumId ?? null,
    durationSec: Number.isFinite(t.durationSec) && t.durationSec > 0 ? t.durationSec : 0,
    artworkUrl: t.artworkUrl ?? null, streamUrl: t.streamUrl,
  };
  if (t.unavailableAt) out.unavailableAt = t.unavailableAt;
  if (t.unavailableReason) out.unavailableReason = t.unavailableReason;
  return out;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function buildSnapshot(s: PlayerStateLike): FullState {
  const track = s.queue[s.index] ?? null;
  return {
    trackId: track?.id ?? null,
    index: track ? s.index : -1,
    queueHash: queueHash(s.queue),
    position: clamp(s.position, 0, 86_400),
    duration: clamp(s.duration || track?.durationSec || 0, 0, 86_400),
    isPlaying: !!track && s.isPlaying,
    volume: clamp(s.volume, 0, 1),
    muted: s.muted,
    track: track ? plainTrack(track) : null,
    upNext: track ? s.queue.slice(s.index + 1, s.index + 1 + UP_NEXT_MAX).map(plainTrack) : [],
    queueLength: s.queue.length,
    loopMode: s.loopMode,
    shuffle: s.shuffle,
    context: s.context,
  };
}

export function lightOf(full: FullState): LightState {
  const { trackId, index, queueHash: hash, position, duration, isPlaying, volume, muted } = full;
  return { trackId, index, queueHash: hash, position, duration, isPlaying, volume, muted };
}
