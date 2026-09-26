/** Song-skip investigation, engine boundary: which Rust event becomes which
 *  provider callback.
 *
 *  The desktop engine has exactly two ways to say something went wrong, and
 *  they mean opposite things to the player: `audio:error` (load failed, or
 *  the stall watchdog fired) makes the provider fall back to web audio and
 *  keep the song, while `audio:ended` makes it play the NEXT song. The engine
 *  sends `audio:ended` for a source that ran out - which, per
 *  apps/desktop/src-tauri/src/audio/skip_repro.rs, is also what a dead stream
 *  and an unservicable seek produce. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTauriBackend } from './tauriBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

type Listener = (e: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const invoked: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return Promise.resolve();
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, fn: Listener) => {
    listeners.set(name, fn);
    return Promise.resolve(() => listeners.delete(name));
  },
}));

/** Fire a Rust event and let the listen() promises settle first. */
async function emit(name: string, payload: unknown = {}) {
  await Promise.resolve();
  listeners.get(name)?.({ payload });
}

beforeEach(() => {
  listeners.clear();
  invoked.length = 0;
});

describe('tauriBackend', () => {
  it('turns the engine "ended" event into onEnded, which is the auto-advance', async () => {
    const events = makeFakeEvents();
    createTauriBackend(events);

    await emit('audio:ended');

    expect(events.onEnded).toHaveBeenCalledTimes(1);
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('turns the engine "error" event into onError, the path that keeps the song', async () => {
    const events = makeFakeEvents();
    createTauriBackend(events);

    await emit('audio:error', { message: 'playback stalled at 41.0s' });

    expect(events.onError).toHaveBeenCalledTimes(1);
    expect(events.onEnded).not.toHaveBeenCalled();
  });

  it('passes on the engine verdict that web audio cannot help', async () => {
    const events = makeFakeEvents();
    createTauriBackend(events);

    // The host could not deliver the song at all (its download failed and no
    // live stream could stand in): a browser would ask the same server the
    // same question, so the provider must not swap engines over it.
    await emit('audio:error', { message: 'the host refused the song', retry: 'none' });

    expect(events.onError).toHaveBeenCalledWith({ canRetryOnWebAudio: false });
  });

  it('keeps asking for web audio when the engine itself came up short', async () => {
    const events = makeFakeEvents();
    createTauriBackend(events);

    await emit('audio:error', { message: 'this engine could not decode the song', retry: 'web-audio' });

    expect(events.onError).toHaveBeenCalledWith({ canRetryOnWebAudio: true });
  });

  it('treats an error with no verdict (an older engine) as worth a web-audio try', async () => {
    const events = makeFakeEvents();
    createTauriBackend(events);

    await emit('audio:error', { message: 'playback stalled at 41.0s' });

    expect(events.onError).toHaveBeenCalledWith({ canRetryOnWebAudio: true });
  });

  it('reports paused once the engine fails, so the play button asks it to play (bughunt P07)', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/abc', { autoplay: true });

    // The load failed: nothing is playing. The mirror used to keep saying
    // "playing", so the provider's toggle sent pause, over and over, and the
    // play button did nothing at all.
    await emit('audio:error', { message: 'the host refused the song', retry: 'none' });

    expect(backend.isPaused()).toBe(true);
    invoked.length = 0;
    backend.play();
    expect(invoked.map((i) => i.cmd)).toEqual(['audio_play']);
    expect(backend.isPaused()).toBe(false);
  });

  it('passes the track id as the cache key, so the engine can play its cached copy', () => {
    const backend = createTauriBackend(makeFakeEvents());
    backend.load('/api/youtube/stream/abc', { autoplay: true, cacheKey: 'youtube:abc' });

    const load = invoked.find((i) => i.cmd === 'audio_load');
    expect(load?.args).toMatchObject({
      url: `${window.location.origin}/api/youtube/stream/abc`,
      cacheKey: 'youtube:abc',
    });
  });

  it('turns the cache adapter stand-in into a cache key the engine resolves itself', () => {
    const backend = createTauriBackend(makeFakeEvents());
    backend.load('cache:youtube:abc', { autoplay: true });

    const load = invoked.find((i) => i.cmd === 'audio_load');
    expect(load?.args).toMatchObject({ url: 'cache:youtube:abc', cacheKey: 'youtube:abc' });
  });

  it('sends no cache key when there is none', () => {
    const backend = createTauriBackend(makeFakeEvents());
    backend.load('/api/youtube/stream/abc', { autoplay: false });

    expect(invoked.find((i) => i.cmd === 'audio_load')?.args).toMatchObject({ cacheKey: null });
  });

  it('forwards a seek unclamped when the engine reported no duration, leaving the engine to judge it', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    // A live-proxied googlevideo body is a fragmented mp4: the engine's
    // decoder reports 0s, so nothing clamps the target here.
    await emit('audio:duration', { sec: 0 });

    backend.seek(91);

    expect(invoked.filter((i) => i.cmd === 'audio_seek')).toEqual([
      { cmd: 'audio_seek', args: { sec: 91 } },
    ]);
    // The slider moves optimistically, as it does on every backend. A seek
    // the engine cannot service (a proxied stream whose decoder reports no
    // duration) is refused there rather than ending the track, and the next
    // position tick puts the slider back: see audio.rs's seek_target and
    // a_seek_in_a_proxied_fragmented_stream_is_refused_not_fatal.
    expect(events.onTime).toHaveBeenCalledWith(91);
  });
});

describe('tauriBackend at the end of a song (bughunt 2026-09-25 D1)', () => {
  it('reports a pause when nothing followed the end: the queue ran out', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/abc', { autoplay: true });
    await emit('audio:play');

    // The provider's onEnded found nothing next and did nothing. A browser
    // reports 'pause' at the end; the engine said nothing, so the play
    // button stayed on "pause" over silence.
    await emit('audio:ended');

    expect(events.onEnded).toHaveBeenCalledTimes(1);
    expect(events.onPause).toHaveBeenCalledTimes(1);
    expect(backend.isPaused()).toBe(true);
  });

  it('reports no pause when the provider moved on to the next song', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });
    await emit('audio:play');
    vi.mocked(events.onEnded).mockImplementation(() => backend.load('/api/youtube/stream/b', { autoplay: true }));

    await emit('audio:ended');

    expect(events.onPause).not.toHaveBeenCalled();
    expect(backend.isPaused()).toBe(false);
  });

  it('reports no pause on repeat one (a seek to 0 and a play)', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });
    await emit('audio:play');
    vi.mocked(events.onEnded).mockImplementation(() => { backend.seek(0); backend.play(); });

    await emit('audio:ended');

    expect(events.onPause).not.toHaveBeenCalled();
    expect(backend.isPaused()).toBe(false);
  });

  it('reports nothing once it has been swapped out for web audio', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    // An early end runs the provider's error path, which may destroy this
    // backend and hand the song to web audio.
    vi.mocked(events.onEnded).mockImplementation(() => backend.destroy());

    await emit('audio:ended');

    expect(events.onPause).not.toHaveBeenCalled();
  });
});

describe('tauriBackend and reports about the song it just left (bughunt 2026-09-25 D5)', () => {
  const tokens = () => invoked.filter((i) => i.cmd === 'audio_load').map((i) => i.args?.token);

  it('tags every load, so the engine can say which one a report is about', () => {
    const backend = createTauriBackend(makeFakeEvents());
    backend.load('/api/youtube/stream/a', { autoplay: true });
    backend.load('/api/youtube/stream/b', { autoplay: true });
    expect(tokens()).toEqual([1, 2]);
  });

  it("drops the previous song's playhead that arrives after the next load", async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });
    await emit('audio:time', { sec: 149, token: 1 });
    vi.mocked(events.onTime).mockClear();
    backend.load('/api/youtube/stream/b', { autoplay: true });

    // Sent by song A's timer a moment before the engine saw the load of B.
    // Taken as B's, it put the slider at 2:30 of a song that had not
    // started, and was saved as where B resumes.
    await emit('audio:time', { sec: 150, token: 1 });

    expect(events.onTime).not.toHaveBeenCalled();
    expect(backend.getCurrentTime()).toBe(0);
    expect(backend.isTransitioning()).toBe(true);

    await emit('audio:time', { sec: 0.25, token: 2 });
    expect(events.onTime).toHaveBeenCalledWith(0.25);
  });

  it("drops the previous song's end, which would skip the next song", async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });
    backend.load('/api/youtube/stream/b', { autoplay: true });

    await emit('audio:ended', { token: 1 });
    await emit('audio:error', { message: 'playback stalled at 41.0s', retry: 'web-audio', token: 1 });

    expect(events.onEnded).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("drops the previous song's length and play", async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });
    backend.load('/api/youtube/stream/b', { autoplay: false });

    await emit('audio:duration', { sec: 30, token: 1 });
    await emit('audio:play', { token: 1 });

    expect(events.onDuration).not.toHaveBeenCalled();
    expect(events.onPlay).not.toHaveBeenCalled();
    expect(backend.isPaused()).toBe(true);
    // A's 30 s length would have clamped a seek into B.
    backend.seek(100);
    expect(invoked.filter((i) => i.cmd === 'audio_seek').at(-1)?.args).toEqual({ sec: 100 });
  });

  it('takes untagged reports as before (an older desktop build)', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    backend.load('/api/youtube/stream/a', { autoplay: true });

    await emit('audio:time', { sec: 3 });
    await emit('audio:ended');

    expect(events.onTime).toHaveBeenCalledWith(3);
    expect(events.onEnded).toHaveBeenCalledTimes(1);
  });
});

describe('tauriBackend stop', () => {
  it('reports paused after stop, so an OS toggle key asks the engine to play, not pause', async () => {
    const backend = createTauriBackend(makeFakeEvents());
    backend.load('/api/youtube/stream/a', { autoplay: true });
    await emit('audio:play');
    backend.stop();
    expect(backend.isPaused()).toBe(true);
  });
});

describe('tauriBackend teardown (bughunt 2026-09-25 D6)', () => {
  it('drops a listener that finished registering after destroy', async () => {
    const events = makeFakeEvents();
    const backend = createTauriBackend(events);
    // Destroyed before any listen() promise resolved (a fast unmount, or a
    // swap to web audio during startup): those listeners were never removed,
    // so the dead engine's events kept driving the player.
    backend.destroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(listeners.size).toBe(0);
  });
});

describe('tauriBackend setVolume with normalization', () => {
  const lastAmplitude = () =>
    invoked.filter((c) => c.cmd === 'audio_set_volume').at(-1)?.args?.amplitude as number;

  it('multiplies the curve by the song gain, capped at 1 outside party mode', () => {
    const b = createTauriBackend(makeFakeEvents());
    b.setVolume(0.64, { normGain: 0.5 });
    expect(lastAmplitude()).toBeCloseTo(0.256, 5);
    b.setVolume(1, { normGain: 2 });
    expect(lastAmplitude()).toBe(1);
    b.setVolume(0.64);
    expect(lastAmplitude()).toBeCloseTo(0.512, 5);
  });

  it('party mode amplifies the normalized level', () => {
    const b = createTauriBackend(makeFakeEvents());
    b.setVolume(0.5, { gain: 2, normGain: 0.5 });
    expect(lastAmplitude()).toBeCloseTo(0.5, 5);
  });
});
