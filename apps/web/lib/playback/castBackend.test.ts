import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCastBackend, isCastBackend, type CastMedia, type CastRemote, type CastRemoteStatus } from './castBackend';
import { makeFakeEvents, makeTrack } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));

/** A receiver that does what it is told and reports it. */
function fakeRemote() {
  let status: CastRemoteStatus = { state: 'idle', time: 0, duration: 0, idleReason: null };
  const subs = new Set<(s: CastRemoteStatus) => void>();
  const remote = {
    load: vi.fn<(m: CastMedia, o: { startAt: number; autoplay: boolean }) => Promise<void>>(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    status: () => status,
    subscribe: (cb: (s: CastRemoteStatus) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit(patch: Partial<CastRemoteStatus>) {
      status = { ...status, ...patch };
      for (const cb of subs) cb(status);
    },
    subs,
  };
  return remote satisfies CastRemote & { emit: unknown };
}

const A = makeTrack({ id: 'youtube:aaaaaaaaaaa', title: 'Song A', artist: 'Band', album: 'LP' });
const media = (t = A): CastMedia => ({ url: `https://h/s/${t.id}?st=x`, contentType: 'audio/mp4', title: t.title, artist: t.artist, album: t.album, artworkUrl: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

let remote: ReturnType<typeof fakeRemote>;
let events: ReturnType<typeof makeFakeEvents>;
beforeEach(() => {
  remote = fakeRemote();
  events = makeFakeEvents();
});

describe('cast backend', () => {
  it('signs the track, then loads it on the device at the start position', async () => {
    const resolve = vi.fn(async () => media());
    const b = createCastBackend(events, remote, resolve);
    expect(isCastBackend(b)).toBe(true);
    b.loadTrack(A, { autoplay: true, startAt: 42 });
    expect(b.isTransitioning()).toBe(true);
    expect(b.getCurrentTime()).toBe(42);
    await flush();
    expect(resolve).toHaveBeenCalledWith(A);
    expect(remote.load).toHaveBeenCalledWith(media(), { startAt: 42, autoplay: true });
    expect(b.isTransitioning()).toBe(false);
  });

  it('a newer load wins over one still signing', async () => {
    let release!: (m: CastMedia) => void;
    const B = makeTrack({ id: 'youtube:bbbbbbbbbbb' });
    const resolve = vi.fn((t) => (t.id === A.id ? new Promise<CastMedia>((r) => { release = r; }) : Promise.resolve(media(B))));
    const b = createCastBackend(events, remote, resolve);
    b.loadTrack(A, { autoplay: true });
    b.loadTrack(B, { autoplay: true });
    await flush();
    release(media(A));
    await flush();
    expect(remote.load).toHaveBeenCalledTimes(1);
    expect(remote.load.mock.calls[0][0].url).toContain(B.id);
  });

  it('mirrors the receiver: time, duration, play and pause', async () => {
    const b = createCastBackend(events, remote, async () => media());
    b.loadTrack(A, { autoplay: true });
    await flush();
    remote.emit({ state: 'playing', time: 3, duration: 200 });
    expect(events.onPlay).toHaveBeenCalled();
    expect(events.onDuration).toHaveBeenCalledWith(200);
    expect(events.onTime).toHaveBeenCalledWith(3);
    expect(b.isPaused()).toBe(false);
    remote.emit({ state: 'paused', time: 4 });
    expect(events.onPause).toHaveBeenCalled();
    expect(b.isPaused()).toBe(true);
    expect(b.getDuration()).toBe(200);
  });

  it('a song that finished is one ended; the old song leaving during a load is not', async () => {
    const b = createCastBackend(events, remote, async () => media());
    b.loadTrack(A, { autoplay: true });
    // While the next song loads, the receiver reports the old one interrupted.
    remote.emit({ state: 'idle', idleReason: 'interrupted' });
    await flush();
    remote.emit({ state: 'playing', time: 1, idleReason: null });
    remote.emit({ state: 'idle', time: 0, idleReason: 'finished' });
    remote.emit({ state: 'idle', time: 0, idleReason: 'finished' });
    expect(events.onEnded).toHaveBeenCalledTimes(1);
  });

  it('a finished report before the song was ever heard is not its end', async () => {
    const b = createCastBackend(events, remote, async () => media());
    b.loadTrack(A, { autoplay: true });
    await flush();
    remote.emit({ state: 'idle', idleReason: 'finished' });
    expect(events.onEnded).not.toHaveBeenCalled();
  });

  it('a receiver error or a signing failure is an error the host caused, not the engine', async () => {
    const b = createCastBackend(events, remote, async () => media());
    b.loadTrack(A, { autoplay: true });
    await flush();
    remote.emit({ state: 'idle', idleReason: 'error' });
    expect(events.onError).toHaveBeenCalledWith({ canRetryOnWebAudio: false });

    const failing = createCastBackend(events, fakeRemote(), async () => { throw new Error('401'); });
    failing.loadTrack(A, { autoplay: true });
    await flush();
    expect(events.onError).toHaveBeenCalledTimes(2);
  });

  it('transport and the volume slider go to the device', () => {
    const b = createCastBackend(events, remote, async () => media());
    b.play();
    b.pause();
    b.seek(30);
    b.stop();
    b.setVolume(0.4, { gain: 2, normGain: 0.5 });
    b.setVolume(3);
    b.setVolume(-1);
    expect(remote.play).toHaveBeenCalled();
    expect(remote.pause).toHaveBeenCalled();
    expect(remote.seek).toHaveBeenCalledWith(30);
    expect(events.onTime).toHaveBeenCalledWith(30);
    expect(remote.stop).toHaveBeenCalled();
    // The device's own level: party gain and normalization do not apply.
    expect(remote.setVolume.mock.calls.map((c) => c[0])).toEqual([0.4, 1, 0]);
  });

  it('destroy stops listening, and a load in flight lands nowhere', async () => {
    const b = createCastBackend(events, remote, async () => media());
    b.loadTrack(A, { autoplay: true });
    b.destroy();
    await flush();
    expect(remote.load).not.toHaveBeenCalled();
    expect(remote.subs.size).toBe(0);
  });
});
