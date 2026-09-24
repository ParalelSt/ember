import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { SessionState, Track } from '@/types/track';

/** The host side of a carlist runs from the app shell, not the session page:
 *  guest skips and new songs keep working after the host leaves the page,
 *  and a session that ended or vanished releases the hosting flag (which
 *  otherwise switches radio off for good). Bughunt X6. */

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  consumeSessionCommands: vi.fn(),
  publishSessionNow: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/logger/client', () => ({ logger: { breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const next = vi.hoisted(() => vi.fn());
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ next, index: usePlayerStore.getState().index }),
}));

const { useSessionHost, startHosting } = await import('./useSessionHost');

const a = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A' });
const b = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B' });
const mine1 = makeTrack({ id: 'youtube:m1', sourceId: 'm1', title: 'Mine 1' });
const mine2 = makeTrack({ id: 'youtube:m2', sourceId: 'm2', title: 'Mine 2' });
const mine3 = makeTrack({ id: 'youtube:m3', sourceId: 'm3', title: 'Mine 3' });

function state(over: Partial<SessionState['session']> = {}, tracks: Track[] = [a, b]): SessionState {
  return {
    session: { id: 's1', code: 'ABCDEF', name: 'Roadtrip', active: true, nowIndex: 0, hostName: 'me', isHost: true, ...over },
    queue: tracks.map((track, i) => ({ id: `st${i}`, position: i + 1, played: false, addedByName: 'me', track })),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.consumeSessionCommands.mockResolvedValue({ commands: [] });
  api.publishSessionNow.mockResolvedValue({ ok: true });
  usePlayerStore.setState({ queue: [], index: -1, orderBackup: null, shuffle: false });
  useSessionStore.setState({ hostingSessionId: 's1' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionHost (app-level, no session page open)', () => {
  it('runs guest skips while hosting', async () => {
    api.getSession.mockResolvedValue(state());
    api.consumeSessionCommands.mockResolvedValue({ commands: [{ type: 'skip' }] });
    renderHook(() => useSessionHost(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(api.consumeSessionCommands).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(next).toHaveBeenCalled());
  });

  it('keeps mirroring songs guests add into the player queue', async () => {
    api.getSession.mockResolvedValue(state());
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['youtube:a', 'youtube:b']));
  });

  it('releases the hosting flag once the session has ended', async () => {
    api.getSession.mockResolvedValue(state({ active: false }));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(useSessionStore.getState().hostingSessionId).toBeNull());
  });

  it('releases the hosting flag when the session is gone', async () => {
    api.getSession.mockRejectedValue(Object.assign(new Error('Session not found.'), { status: 404 }));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(useSessionStore.getState().hostingSessionId).toBeNull());
  });

  it('keeps the flag through a network blip', async () => {
    api.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
  });

  it('does nothing when not hosting', async () => {
    useSessionStore.setState({ hostingSessionId: null });
    renderHook(() => useSessionHost(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.getSession).not.toHaveBeenCalled();
    expect(api.consumeSessionCommands).not.toHaveBeenCalled();
  });
});

/** Starting a carlist while your own music is queued: guests read the
 *  published position as a row of the SESSION queue, so it has to be one,
 *  and their songs have to come next, not after your leftovers. Bughunt X5. */
describe('carlist started with music already queued', () => {
  it('drops the leftover queue at start but keeps the playing song', () => {
    usePlayerStore.setState({ queue: [mine1, mine2, mine3], index: 1, shuffle: true, orderBackup: [mine3, mine1, mine2] });
    useSessionStore.setState({ hostingSessionId: null });
    startHosting('s1');
    const st = usePlayerStore.getState();
    expect(st.queue.map((t) => t.id)).toEqual(['youtube:m2']);
    expect(st.index).toBe(0);
    // Turning shuffle off must not bring the old queue back.
    expect(st.orderBackup).toBeNull();
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
  });

  it("queues the group's songs right after the playing song", async () => {
    usePlayerStore.setState({ queue: [mine1, mine2, mine3], index: 1 });
    startHosting('s1');
    api.getSession.mockResolvedValue(state());
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() =>
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['youtube:m2', 'youtube:a', 'youtube:b']),
    );
  });

  it('publishes the session row of the playing song, not the player index', async () => {
    // Player: [own song, a, b], playing a (player index 1 = session row 0).
    usePlayerStore.setState({ queue: [mine1, a, b], index: 1 });
    api.getSession.mockResolvedValue(state({ nowIndex: 1 }));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenCalled());
    expect(api.publishSessionNow).toHaveBeenLastCalledWith('s1', 0);
    expect(api.publishSessionNow).not.toHaveBeenCalledWith('s1', 1);
  });

  it('publishes nothing while a song outside the session plays', async () => {
    usePlayerStore.setState({ queue: [mine1, a, b], index: 0 });
    api.getSession.mockResolvedValue(state());
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(api.publishSessionNow).not.toHaveBeenCalled();
  });

  it('points a song the group added twice at its first row', async () => {
    // The host queues a repeat once, where it first appears (prev from b).
    usePlayerStore.setState({ queue: [mine1, a, b], index: 1 });
    api.getSession.mockResolvedValue(state({ nowIndex: 1 }, [a, b, a]));
    renderHook(() => useSessionHost(), { wrapper });
    await waitFor(() => expect(api.publishSessionNow).toHaveBeenCalledWith('s1', 0));
    expect(api.publishSessionNow).toHaveBeenCalledTimes(1);
  });
});
