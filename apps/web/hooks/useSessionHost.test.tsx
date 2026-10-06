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
