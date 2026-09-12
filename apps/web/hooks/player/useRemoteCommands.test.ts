import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteCommands } from './useRemoteCommands';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import { useOfflineStore } from '@/stores/useOfflineStore';
import type { Track } from '@/types/track';

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });

let next: Mock<() => void>;
let prev: Mock<() => void>;

interface Props {
  backendReady: boolean;
  current: Track | null;
}

function setup(backend: FakeBackend | null, initial: Props) {
  const backendRef = { current: backend };
  const nextRef = { current: () => next() };
  const prevRef = { current: () => prev() };
  const view = renderHook(
    ({ backendReady, current }: Props) =>
      useRemoteCommands({ backendRef, backendReady, current, nextRef, prevRef }),
    { initialProps: initial },
  );
  return { backendRef, nextRef, prevRef, view };
}

beforeEach(() => {
  next = vi.fn();
  prev = vi.fn();
  useOfflineStore.setState({ artFiles: {} });
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('useRemoteCommands', () => {
  it('registers the transport once the backend is ready', () => {
    const backend = makeFakeBackend();
    setup(backend, { backendReady: true, current: a });
    expect(backend.setRemoteCommands).toHaveBeenCalledTimes(1);
    expect(backend.remote).not.toBeNull();
  });

  it('registers nothing before the backend exists', () => {
    const backend = makeFakeBackend();
    const { view } = setup(backend, { backendReady: false, current: a });
    expect(backend.setRemoteCommands).not.toHaveBeenCalled();
    // ...and wires up on the render where the backend announces itself.
    view.rerender({ backendReady: true, current: a });
    expect(backend.setRemoteCommands).toHaveBeenCalledTimes(1);
  });

  it('routes a remote next/prev through the refs, so a later handler wins', () => {
    const backend = makeFakeBackend();
    const { nextRef, prevRef, view } = setup(backend, { backendReady: true, current: a });
    backend.remote!.next();
    expect(next).toHaveBeenCalledTimes(1);
    backend.remote!.prev();
    expect(prev).toHaveBeenCalledTimes(1);

    // The provider swaps these on every render; the registered commands must
    // pick the new ones up without re-registering.
    const later = vi.fn();
    nextRef.current = later;
    prevRef.current = later;
    view.rerender({ backendReady: true, current: b });
    backend.remote!.next();
    expect(later).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(backend.setRemoteCommands).toHaveBeenCalledTimes(1);
  });

  it('routes remote play/pause/seek to the backend', () => {
    const backend = makeFakeBackend();
    setup(backend, { backendReady: true, current: a });
    backend.remote!.play();
    backend.remote!.pause();
    backend.remote!.seek(42);
    expect(backend.play).toHaveBeenCalledTimes(1);
    expect(backend.pause).toHaveBeenCalledTimes(1);
    expect(backend.seek).toHaveBeenCalledWith(42);
  });

  it('sets media metadata for the current track and on every track change', () => {
    const backend = makeFakeBackend();
    const { view } = setup(backend, { backendReady: true, current: a });
    expect(backend.setMetadata).toHaveBeenCalledWith(a, null);
    view.rerender({ backendReady: true, current: b });
    expect(backend.setMetadata).toHaveBeenLastCalledWith(b, null);
    expect(backend.setMetadata).toHaveBeenCalledTimes(2);
  });

  it('does not re-set metadata for a re-render of the same track', () => {
    const backend = makeFakeBackend();
    const { view } = setup(backend, { backendReady: true, current: a });
    view.rerender({ backendReady: true, current: { ...a } });
    expect(backend.setMetadata).toHaveBeenCalledTimes(1);
  });

  it('clears metadata when the queue empties', () => {
    const backend = makeFakeBackend();
    const { view } = setup(backend, { backendReady: true, current: a });
    view.rerender({ backendReady: true, current: null });
    expect(backend.setMetadata).toHaveBeenLastCalledWith(null, null);
  });

  it('passes the converted local art path when the current track has a downloaded copy with art', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      convertFileSrc: (p: string) => `capfile://${p}`,
    };
    useOfflineStore.setState({ artFiles: { [a.id]: '/data/art/a.jpg' } });
    const backend = makeFakeBackend();
    setup(backend, { backendReady: true, current: a });
    expect(backend.setMetadata).toHaveBeenCalledWith(a, 'capfile:///data/art/a.jpg');
  });

  it('survives a first render with no backend at all', () => {
    expect(() => setup(null, { backendReady: false, current: a })).not.toThrow();
  });
});
