import { makeTrack } from './fakeBackend';
import type { FullState, LightState } from '@/lib/remote/types';

/** Bodies for the remote control routes' tests (lib/remote). Test-only. */
export const REMOTE_TRACK = makeTrack({ id: 'youtube:t1', sourceId: 't1', streamUrl: '/api/youtube/stream/t1' });

export const remoteLight = (over: Partial<LightState> = {}): LightState => ({
  trackId: REMOTE_TRACK.id, index: 0, queueHash: 'h1', position: 10, duration: 191,
  isPlaying: true, volume: 0.5, muted: false, ...over,
});

export const remoteFull = (over: Partial<FullState> = {}): FullState => ({
  ...remoteLight(), track: REMOTE_TRACK, upNext: [], queueLength: 1, loopMode: 'off', shuffle: false, context: null, ...over,
});

export const beatBody = (deviceId: string, over: Record<string, unknown> = {}) => ({
  deviceId, label: 'Windows', platform: 'windows', shell: 'web', acked: [], full: remoteFull(), ...over,
});

export const queueOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...REMOTE_TRACK, id: `youtube:q${i}`, sourceId: `q${i}` }));
