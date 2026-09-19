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
