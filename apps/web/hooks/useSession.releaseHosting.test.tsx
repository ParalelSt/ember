import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LiveCarlist } from '@/types/track';

// This device's hosting flag (stores/useSessionStore, persisted) turns radio
// off. Hosts often just close the app instead of ending the carlist, so the
// session page never sees it end: the flag must also let go once the server
// says this device's carlist is no longer live, or radio stays off for good.

const live = vi.hoisted(() => ({ carlist: null as LiveCarlist | null, calls: 0 }));
vi.mock('@/lib/api', () => ({
  api: {
    getLiveCarlist: async () => {
      live.calls += 1;
      return { carlist: live.carlist };
    },
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const { useReleaseStaleHosting } = await import('./useSession');
const { useSessionStore } = await import('@/stores/useSessionStore');

function Probe() {
  useReleaseStaleHosting();
  return null;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  live.carlist = null;
  live.calls = 0;
  useSessionStore.setState({ hostingSessionId: null });
});
afterEach(() => useSessionStore.setState({ hostingSessionId: null }));

describe('useReleaseStaleHosting', () => {
  it('clears the flag of a carlist that is no longer live (radio comes back)', async () => {
    useSessionStore.setState({ hostingSessionId: 's1' });
    mount();
    await waitFor(() => expect(useSessionStore.getState().hostingSessionId).toBeNull());
  });

  it('keeps the flag while that carlist is live and hosted here', async () => {
    live.carlist = { id: 's1', code: 'K7MPQ4', name: 'Trip', isHost: true };
    useSessionStore.setState({ hostingSessionId: 's1' });
    mount();
    await waitFor(() => expect(live.calls).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
  });

  it('clears it when the live carlist is someone else\'s (joined, not hosting)', async () => {
    live.carlist = { id: 's2', code: 'ABCDEF', name: 'Theirs', isHost: false };
    useSessionStore.setState({ hostingSessionId: 's1' });
    mount();
    await waitFor(() => expect(useSessionStore.getState().hostingSessionId).toBeNull());
  });

  it('an answer from before a new carlist started does not clear it', async () => {
    const qc = mount();
    // A cached "nothing live" from before Go live...
    qc.setQueryData(['carlist', 'live'], null);
    // ...is not a verdict on the carlist that just started; the fresh
    // answer (it is live) is.
    live.carlist = { id: 's9', code: 'NEWONE', name: 'New', isHost: true };
    await act(async () => {
      useSessionStore.setState({ hostingSessionId: 's9' });
    });
    await waitFor(() => expect(live.calls).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useSessionStore.getState().hostingSessionId).toBe('s9');
  });

  it('asks nothing when this device hosts nothing', async () => {
    mount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(live.calls).toBe(0);
  });
});
