import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { usePositionPersistence } from './usePositionPersistence';
import { makeFakeBackend, makeTrack, type FakeBackend } from './fakeBackend';

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });

function setup(backend: FakeBackend | null = makeFakeBackend(), backendReady = true) {
  const backendRef = { current: backend };
  const view = renderHook(
    (ready: boolean) => usePositionPersistence({ backendRef, backendReady: ready }),
    { initialProps: backendReady },
  );
  return { backend, backendRef, view, api: () => view.result.current };
}

function storedPosition() {
  return usePlayerStore.getState().position;
}

beforeEach(() => {
  usePlayerStore.setState({ queue: [a], index: 0, position: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePositionPersistence: persist', () => {
  it('writes the playhead to the store', () => {
    const { backend, api } = setup();
    backend!.currentTime = 73.5;
    backend!.durationSec = 191;
    act(() => api().persist());
    expect(storedPosition()).toBe(73.5);
  });

  it('writes nothing while the backend is transitioning', () => {
    const { backend, api } = setup();
    backend!.currentTime = 73.5;
    backend!.durationSec = 191;
    backend!.transitioning = true;
    act(() => api().persist());
    expect(storedPosition()).toBe(0);
  });

  it('keeps the last trustworthy position instead of a sus 0', () => {
    // Mid-swap the engine reports ~0 with no duration yet. That must not wipe
    // out where the listener actually was.
    const { backend, api } = setup();
    act(() => api().noteTime(40));
    backend!.currentTime = 0.1;
    backend!.durationSec = 0;
    act(() => api().persist());
    expect(storedPosition()).toBe(40);
  });

  it('writes nothing at all when there is no playable duration and no history', () => {
    const { backend, api } = setup();
    backend!.currentTime = 0.1;
    backend!.durationSec = 0;
    usePlayerStore.setState({ position: 12 });
    act(() => api().persist());
    expect(storedPosition()).toBe(12);
  });

  it('survives having no backend', () => {
    const { api } = setup(null);
    expect(() => api().persist()).not.toThrow();
  });

  it('exposes persist through a ref for handlers wired once at mount', () => {
    const { backend, api } = setup();
    backend!.currentTime = 5;
    backend!.durationSec = 191;
    // This is how the backend's onPause event reaches it.
    act(() => api().persistRef.current());
    expect(storedPosition()).toBe(5);
  });
});

describe('usePositionPersistence: write moments', () => {
  it('persists every five seconds while playing', () => {
    vi.useFakeTimers();
    const { backend, api } = setup();
    backend!.durationSec = 191;
    backend!.paused = false;
    backend!.currentTime = 10;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(storedPosition()).toBe(10);
    backend!.currentTime = 15;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(storedPosition()).toBe(15);
    expect(api().persistRef.current).toBeTypeOf('function');
  });

  it('does not persist on the interval while paused', () => {
    vi.useFakeTimers();
    const { backend } = setup();
    backend!.durationSec = 191;
    backend!.paused = true;
    backend!.currentTime = 10;
    act(() => { vi.advanceTimersByTime(15000); });
    expect(storedPosition()).toBe(0);
  });

  it('does not start the interval before the backend is ready', () => {
    vi.useFakeTimers();
    const { backend, view } = setup(makeFakeBackend(), false);
    backend!.durationSec = 191;
    backend!.paused = false;
    backend!.currentTime = 10;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(storedPosition()).toBe(0);
    view.rerender(true);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(storedPosition()).toBe(10);
  });

  it('persists when the tab is hidden and on pagehide', () => {
    const { backend } = setup();
    backend!.durationSec = 191;
    backend!.currentTime = 20;
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(storedPosition()).toBe(20);

    usePlayerStore.setState({ position: 0 });
    backend!.currentTime = 25;
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(storedPosition()).toBe(25);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('stops persisting once unmounted', () => {
    vi.useFakeTimers();
    const { backend, view } = setup();
    backend!.durationSec = 191;
    backend!.paused = false;
    backend!.currentTime = 10;
    view.unmount();
    act(() => { vi.advanceTimersByTime(20000); });
    window.dispatchEvent(new Event('pagehide'));
    expect(storedPosition()).toBe(0);
  });
});

describe('usePositionPersistence: noteTime', () => {
  it('writes through at most once a second', () => {
    vi.useFakeTimers();
    const { api } = setup();
    act(() => api().noteTime(3));
    expect(storedPosition()).toBe(3);
    act(() => api().noteTime(3.25));
    expect(storedPosition()).toBe(3);
    act(() => { vi.advanceTimersByTime(1100); });
    act(() => api().noteTime(4.5));
    expect(storedPosition()).toBe(4.5);
  });

  it('ignores reports during a transition or from the first half second', () => {
    const { backend, api } = setup();
    backend!.transitioning = true;
    act(() => api().noteTime(30));
    expect(storedPosition()).toBe(0);
    backend!.transitioning = false;
    act(() => api().noteTime(0.4));
    expect(storedPosition()).toBe(0);
  });
});

describe('usePositionPersistence: startAt', () => {
  it('resumes the persisted track on a cold start', () => {
    // Nothing has loaded yet, so the stored playhead is taken to belong to the
    // persisted current track.
    usePlayerStore.setState({ queue: [a], index: 0, position: 42 });
    const { api } = setup();
    let at = 0;
    act(() => { at = api().startAt(a.id); });
    expect(at).toBe(42);
    expect(storedPosition()).toBe(42);
  });

  it('does not hand one song the other song position', () => {
    usePlayerStore.setState({ queue: [a], index: 0, position: 42 });
    const { api } = setup();
    let at = 99;
    act(() => { at = api().startAt(b.id); });
    expect(at).toBe(0);
    expect(storedPosition()).toBe(0);
  });

  it('moves ownership to the track it loaded', () => {
    usePlayerStore.setState({ queue: [a], index: 0, position: 42 });
    const { api } = setup();
    act(() => { api().startAt(b.id); });
    // b now owns the playhead, so b resumes and a does not.
    usePlayerStore.setState({ position: 17 });
    expect(api().resumeTargetFor(b.id)).toBe(17);
    expect(api().resumeTargetFor(a.id)).toBe(0);
    let at = 0;
    act(() => { at = api().startAt(b.id); });
    expect(at).toBe(17);
  });

  it('honours a requested start once, then falls back to ownership', () => {
    usePlayerStore.setState({ queue: [a], index: 0, position: 42 });
    const { api } = setup();
    let at = 0;
    act(() => {
      api().requestStartAt(10);
      at = api().startAt(b.id);
    });
    expect(at).toBe(10);
    expect(storedPosition()).toBe(10);
    // The request is consumed: the next load of the same track resumes from
    // the stored playhead instead.
    act(() => { at = api().startAt(b.id); });
    expect(at).toBe(10);
    // ...and a different track starts from zero.
    act(() => { at = api().startAt(a.id); });
    expect(at).toBe(0);
  });

  it('a requested 0 restarts the track', () => {
    usePlayerStore.setState({ queue: [a], index: 0, position: 42 });
    const { api } = setup();
    let at = -1;
    act(() => {
      api().requestStartAt(0);
      at = api().startAt(a.id);
    });
    expect(at).toBe(0);
  });
});
