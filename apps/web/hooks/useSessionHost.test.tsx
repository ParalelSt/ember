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

const { useSessionHost } = await import('./useSessionHost');

const a = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A' });
const b = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B' });

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
