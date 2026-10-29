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

function setup() {
  server.prefs = { ...EMPTY_NAV_PREFS, opened: { a: 3, b: 2, c: 1 } };
  const qc = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useNavPlaylists(ITEMS), { wrapper });
}

const ids = (r: { current: { items: { id: string }[] } }) => r.current.items.map((i) => i.id);

describe('useNavPlaylists', () => {
  it('outside the list, an opened playlist goes to the top', async () => {
    const { result } = setup();
    await waitFor(() => expect(ids(result)).toEqual(['a', 'b', 'c']));
    act(() => result.current.onOpen('c'));
    await waitFor(() => expect(ids(result)).toEqual(['c', 'a', 'b']));
  });

  it('[bug report 2026-10-22] clicking down the list keeps every row in place until the pointer leaves', async () => {
    const { result } = setup();
    await waitFor(() => expect(ids(result)).toEqual(['a', 'b', 'c']));
    act(() => result.current.holdProps.onPointerEnter());
    // Two clicks a moment apart, so their times differ.
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    act(() => result.current.onOpen('b'));
    await waitFor(() => expect(server.prefs!.opened.b).toBeGreaterThan(3));
    act(() => result.current.onOpen('c'));
    await waitFor(() => expect(server.prefs!.opened.c).toBeGreaterThan(3));
    expect(ids(result)).toEqual(['a', 'b', 'c']);
    act(() => result.current.holdProps.onPointerLeave());
    expect(ids(result)).toEqual(['c', 'b', 'a']);
    clock.mockRestore();
  });

  it('a pin still moves the playlist at once, even with the pointer on the list', async () => {
    const { result } = setup();
    await waitFor(() => expect(ids(result)).toEqual(['a', 'b', 'c']));
    act(() => result.current.holdProps.onPointerEnter());
    act(() => result.current.onTogglePin('c'));
    await waitFor(() => expect(ids(result)).toEqual(['c', 'a', 'b']));
  });
});
