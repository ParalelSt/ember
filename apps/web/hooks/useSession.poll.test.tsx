import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionState } from '@/types/track';

// A guest who leaves the carlist page open after the host ended it: the
// page says "This carlist has ended", and nothing can start it again, yet
// it went on asking every 2 s, in the background too, for as long as the
// phone kept the page.

const api = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u2' } }) }));

const { useQuerySession } = await import('./useSession');

const state = (active: boolean): SessionState =>
  ({
    session: {
      id: 's1', code: 'K7MPQ4', name: 'Trip', active, nowIndex: 0,
      hostName: 'Hana', hostId: 'u1', isHost: false, viewerId: 'u2', nowElapsedMs: null,
    },
    members: [],
    queue: [],
  }) as SessionState;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.getSession.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useQuerySession', () => {
  it('keeps asking while the carlist is live', async () => {
    api.getSession.mockResolvedValue(state(true));
    renderHook(() => useQuerySession('s1'), { wrapper });
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(api.getSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stops asking once the carlist has ended', async () => {
    api.getSession.mockResolvedValue(state(false));
    const { result } = renderHook(() => useQuerySession('s1'), { wrapper });
    await waitFor(() => expect(result.current.data?.session.active).toBe(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });
});
