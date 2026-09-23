import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePresenceHeartbeat } from './usePresenceHeartbeat';
import { PRESENCE_INTERVAL_MS } from '@/lib/pranks/presence';
import { makeTrack } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { PresenceReport } from '@/lib/pranks/types';

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });
const engineRef = { current: 'android' };

interface Props { userId: string | null; current: typeof a | null; isPlaying: boolean }

type Send = (r: PresenceReport) => Promise<unknown>;

function setup(send: Send, initialProps: Props) {
  return renderHook((p: Props) => usePresenceHeartbeat({ ...p, engineRef, send }), { initialProps });
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({ position: 42 });
});
afterEach(() => vi.useRealTimers());

describe('usePresenceHeartbeat', () => {
  it('reports at once while playing, then every 20 s', () => {
    const send = vi.fn<Send>(async () => ({}));
    setup(send, { userId: 'u1', current: a, isPlaying: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      track: { id: a.id, title: a.title, artist: a.artist, durationSec: a.durationSec },
      position: 42, isPlaying: true, engine: 'android', appVersion: expect.any(String),
    });
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 2);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('reports a track change and a pause once, then goes quiet', () => {
    const send = vi.fn<Send>(async () => ({}));
    const { rerender } = setup(send, { userId: 'u1', current: a, isPlaying: true });
    rerender({ userId: 'u1', current: b, isPlaying: true });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ track: expect.objectContaining({ title: 'Second Song' }) }));
    rerender({ userId: 'u1', current: b, isPlaying: false });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ isPlaying: false }));
    const n = send.mock.calls.length;
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledTimes(n);
  });

  it('sends nothing signed out or with nothing loaded', () => {
    const send = vi.fn<Send>(async () => ({}));
    setup(send, { userId: null, current: a, isPlaying: true });
    setup(send, { userId: 'u1', current: null, isPlaying: false });
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not repeat the same state inside 3 s', () => {
    const send = vi.fn<Send>(async () => ({}));
    const { rerender } = setup(send, { userId: 'u1', current: a, isPlaying: true });
    rerender({ userId: 'u1', current: { ...a }, isPlaying: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("takes the engine's length when the track carries none (uploads)", () => {
    const send = vi.fn<Send>(async () => ({}));
    usePlayerStore.setState({ duration: 180 });
    setup(send, { userId: 'u1', current: { ...a, durationSec: 0 }, isPlaying: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ track: expect.objectContaining({ durationSec: 180 }) }));
  });

  it('drops a failed send silently', async () => {
    const send = vi.fn<Send>(async () => { throw new Error('offline'); });
    setup(send, { userId: 'u1', current: a, isPlaying: true });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
