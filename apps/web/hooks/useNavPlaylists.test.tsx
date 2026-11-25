import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyNavPatch, EMPTY_NAV_PREFS, type NavPatch, type NavPrefs } from '@/lib/navPlaylists';

// The server keeps whatever the PATCHes made of it, like the real route.
const server = vi.hoisted(() => ({ prefs: null as NavPrefs | null }));
vi.mock('@/lib/api', () => ({
  api: {
    getNavPlaylists: vi.fn(async () => server.prefs),
    patchNavPlaylists: vi.fn(async (p: NavPatch) => {
      server.prefs = applyNavPatch(server.prefs!, p, Date.now());
      return server.prefs;
    }),
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const { useNavPlaylists } = await import('./useNavPlaylists');

const ITEMS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

function setup(opts?: { byOpened?: boolean }) {
  server.prefs = { ...EMPTY_NAV_PREFS, opened: { a: 3, b: 2, c: 1 } };
  const qc = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, ...renderHook(() => useNavPlaylists(ITEMS, opts), { wrapper }) };
}

const ids = (r: { current: { items: { id: string }[] } }) => r.current.items.map((i) => i.id);

describe('useNavPlaylists (Sidebar and Drawer order)', () => {
  it('keeps library order and does not move a playlist when it is opened', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(ids(result)).toEqual(['a', 'b', 'c']);
    act(() => result.current.onOpen('c'));
    await waitFor(() => expect(server.prefs!.opened.c).toBeGreaterThan(1));
    expect(ids(result)).toEqual(['a', 'b', 'c']);
  });

  it('does not reorder after a refetch with new opened times', async () => {
    const { result, qc } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    server.prefs = { pinned: [], opened: { a: 1, b: 2, c: 99 } };
    await act(() => qc.invalidateQueries({ queryKey: ['nav-playlists'] }));
    await waitFor(() => expect(result.current.items.length).toBe(3));
    expect(ids(result)).toEqual(['a', 'b', 'c']);
  });

  it('a pin moves the playlist to the top at once', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.onTogglePin('c'));
    await waitFor(() => expect(ids(result)).toEqual(['c', 'a', 'b']));
  });

  it('a new playlist appears in its library position', async () => {
    server.prefs = { ...EMPTY_NAV_PREFS, opened: { a: 3 } };
    const qc = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ items }) => useNavPlaylists(items), {
      wrapper,
      initialProps: { items: ITEMS },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    rerender({ items: [{ id: 'new' }, ...ITEMS] });
    expect(ids(result)).toEqual(['new', 'a', 'b', 'c']);
  });
});

describe('useNavPlaylists byOpened (phone Recents)', () => {
  it('sorts by last opened', async () => {
    const { result } = setup({ byOpened: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.onOpen('c'));
    await waitFor(() => expect(ids(result)).toEqual(['c', 'a', 'b']));
  });
});
