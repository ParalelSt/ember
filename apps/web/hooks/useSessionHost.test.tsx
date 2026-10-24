import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { SessionState, Track } from '@/types/track';

/** The carlist host role runs from the app shell (SessionHostBridge), not
 *  the session page: a host who goes looking for a song on another page
 *  keeps getting the group's songs and their skips (bughunt X6). */

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  consumeSessionCommands: vi.fn(),
  publishSessionNow: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const next = vi.hoisted(() => vi.fn());
vi.mock('@/components/player/PlayerProvider', async () => {
  const { usePlayerStore: store } = await import('@/stores/usePlayerStore');
  return { usePlayer: () => ({ next, current: store.getState().queue[store.getState().index] ?? null }) };
});

const { useSessionHost, useClaimSessionHost } = await import('./useSessionHost');

const a = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A' });
const b = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B' });

function state(over: Partial<SessionState['session']> = {}, tracks: Track[] = [a, b]): SessionState {
  return {
    session: {
      id: 's1', code: 'K7MPQ4', name: 'Road trip', active: true, nowIndex: 0,
      hostName: 'Me', hostId: 'u1', isHost: true, viewerId: 'u1', nowElapsedMs: null, ...over,
    },
    members: [],
    queue: tracks.map((track, i) => ({ id: `q${i}`, track, addedBy: 'u1', position: i + 1 })) as never,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  api.consumeSessionCommands.mockResolvedValue({ commands: [] });
  api.publishSessionNow.mockResolvedValue({ ok: true });
  usePlayerStore.setState({ queue: [a], index: 0 });
  useSessionStore.setState({ hostingSessionId: 's1' });
});
afterEach(() => vi.useRealTimers());

describe('useSessionHost (app shell, no session page open)', () => {
  it("mirrors the group's songs into the player from any page", async () => {
    api.getSession.mockResolvedValue(state());
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['youtube:a', 'youtube:b']));
    expect(api.getSession).toHaveBeenCalledWith('s1');
  });

  it("carries out a guest's skip from any page", async () => {
    api.getSession.mockResolvedValue(state());
    api.consumeSessionCommands.mockResolvedValue({ commands: [{ type: 'skip' }] });
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(next).toHaveBeenCalled();
  });

  it('does not ask for guest commands while the device is offline, and asks again once it is back', async () => {
    api.getSession.mockResolvedValue(state());
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Each try would only fail and fill the log the bug report carries.
    expect(api.consumeSessionCommands).not.toHaveBeenCalled();
    onLine.mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.consumeSessionCommands).toHaveBeenCalled();
    onLine.mockRestore();
  });

  it('publishes the playing row to a NEW carlist even when it is the same row number as the last one', async () => {
    api.getSession.mockImplementation(async (id: string) => state({ id, nowIndex: 0 }));
    usePlayerStore.setState({ queue: [a, b], index: 1 });
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenCalledWith('s1', 1));
    // That carlist ends; the host starts another one, still on song B.
    act(() => useSessionStore.setState({ hostingSessionId: 's2' }));
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenCalledWith('s2', 1));
  });

  it('tells the server again when it ends up on a row the host has already left', async () => {
    // Forward to B and straight back to A inside one poll: the poll still
    // said A, so going back sent nothing, then the server took B. The row
    // was remembered as told, and guests saw B (and Play next landed after
    // it) for the rest of the song.
    let serverNow = 0;
    api.getSession.mockImplementation(async () => state({ nowIndex: serverNow }));
    api.publishSessionNow.mockImplementation(async (_id: string, row: number) => {
      serverNow = row;
      return { ok: true };
    });
    usePlayerStore.setState({ queue: [a, b], index: 0 });
    const { rerender } = renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());

    act(() => usePlayerStore.setState({ index: 1 }));
    rerender();
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenLastCalledWith('s1', 1));
    act(() => usePlayerStore.setState({ index: 0 }));
    rerender();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenLastCalledWith('s1', 0));
    expect(serverNow).toBe(0);
  });

  it('tells the server again once a send that failed (no signal) can get through', async () => {
    // The song changed in a tunnel: the send failed, and nothing sent it
    // again until the NEXT song, so guests saw the old song (and their Play
    // next went in before the one playing, where it never played).
    let serverNow = 0;
    api.getSession.mockImplementation(async () => state({ nowIndex: serverNow }));
    api.publishSessionNow.mockRejectedValueOnce(new Error('offline'));
    api.publishSessionNow.mockImplementation(async (_id: string, row: number) => {
      serverNow = row;
      return { ok: true };
    });
    usePlayerStore.setState({ queue: [a, b], index: 0 });
    const { rerender } = renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());

    act(() => usePlayerStore.setState({ index: 1 }));
    rerender();
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenCalledTimes(1));
    expect(serverNow).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    await waitFor(() => expect(serverNow).toBe(1));
  });

  it('does nothing while this device hosts nothing', async () => {
    useSessionStore.setState({ hostingSessionId: null });
    renderHook(() => useSessionHost(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.getSession).not.toHaveBeenCalled();
    expect(api.consumeSessionCommands).not.toHaveBeenCalled();
  });

  it('lets go of the flag once the carlist has ended', async () => {
    api.getSession.mockResolvedValue(state({ active: false }));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(useSessionStore.getState().hostingSessionId).toBeNull());
    expect(api.consumeSessionCommands).not.toHaveBeenCalled();
  });
});

describe('useClaimSessionHost (session page)', () => {
  it('claims the host role for its own live carlist, and never drops it on leaving', () => {
    useSessionStore.setState({ hostingSessionId: null });
    const { unmount } = renderHook(() => useClaimSessionHost(state()));
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
    unmount();
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
  });

  it("a guest's page claims nothing", () => {
    useSessionStore.setState({ hostingSessionId: null });
    renderHook(() => useClaimSessionHost(state({ isHost: false })));
    expect(useSessionStore.getState().hostingSessionId).toBeNull();
  });
});
