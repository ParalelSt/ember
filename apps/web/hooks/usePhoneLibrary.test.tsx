import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const state = vi.hoisted(() => ({
  nav: { items: [] as { id: string; pinId: string }[], ready: true },
  playlists: [] as { id: string; pinId: string }[],
}));
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({ playlists: state.playlists, downloadedIds: new Set<string>() }),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryLikes: () => ({ data: [] }),
  useQueryHistory: () => ({ data: [] }),
  useQueryUploads: () => ({ data: [] }),
}));
vi.mock('@/hooks/useNavPlaylists', () => ({
  useNavPlaylists: () => ({ items: state.nav.items, ready: state.nav.ready, onOpen: vi.fn(), onTogglePin: vi.fn() }),
}));
vi.mock('@/lib/library', () => ({
  buildLibraryItems: ({ playlists }: { playlists: { id: string }[] }) => playlists,
}));

const { usePhoneLibrary } = await import('./usePhoneLibrary');
const mk = (...xs: string[]) => xs.map((id) => ({ id, pinId: id }));
const ids = (r: { current: { items: unknown[] } }) => (r.current.items as { id: string }[]).map((i) => i.id);

describe('usePhoneLibrary Recents', () => {
  it('shows the most recently opened first on a fresh visit', () => {
    state.playlists = mk('a', 'b', 'c');
    state.nav = { items: mk('c', 'a', 'b'), ready: true };
    const { result } = renderHook(() => usePhoneLibrary());
    expect(ids(result)).toEqual(['c', 'a', 'b']);
  });

  it('does not move during the visit, then reflects the new order on the next visit', () => {
    state.playlists = mk('a', 'b', 'c');
    state.nav = { items: mk('c', 'a', 'b'), ready: true };
    const first = renderHook(() => usePhoneLibrary());
    state.nav = { items: mk('b', 'c', 'a'), ready: true };
    first.rerender();
    expect(ids(first.result)).toEqual(['c', 'a', 'b']);
    // A playlist created meanwhile goes on top.
    state.nav = { items: mk('new', 'b', 'c', 'a'), ready: true };
    first.rerender();
    expect(ids(first.result)).toEqual(['new', 'c', 'a', 'b']);
    first.unmount();
    const second = renderHook(() => usePhoneLibrary());
    expect(ids(second.result)).toEqual(['new', 'b', 'c', 'a']);
  });

  it('waits for the saved times before it holds an order', () => {
    state.playlists = mk('a', 'b');
    state.nav = { items: mk('a', 'b'), ready: false };
    const { result, rerender } = renderHook(() => usePhoneLibrary());
    state.nav = { items: mk('b', 'a'), ready: true };
    act(() => rerender());
    expect(ids(result)).toEqual(['b', 'a']);
  });
});
