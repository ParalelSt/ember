import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLikeRule, useLikeToggle } from './useLikeToggle';
import type { Track } from '@/types/track';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({
  listLikes: vi.fn(),
  like: vi.fn(),
  unlike: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const toast = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

const likedTrack = makeTrack();
// Same title and artist, different upload: a look-alike that is NOT liked.
const variant = makeTrack({
  id: 'youtube:b2',
  sourceId: 'b2',
  title: 'Midnight Drive (Official Video)',
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup(track: Track | null) {
  return renderHook(() => useLikeToggle(track), { wrapper });
}

beforeEach(() => {
  auth.user = { id: 'u1' };
  vi.clearAllMocks();
  api.listLikes.mockResolvedValue({ tracks: [likedTrack] });
  api.like.mockResolvedValue({ ok: true });
  api.unlike.mockResolvedValue({ ok: true });
});

describe('useLikeToggle', () => {
  it('does not count a look-alike variant as liked', async () => {
    const { result } = setup(variant);
    await waitFor(() => expect(api.listLikes).toHaveBeenCalled());
    expect(result.current.liked).toBe(false);
  });

  it('counts the exact liked id as liked and unlikes exactly it', async () => {
    const { result } = setup(likedTrack);
    await waitFor(() => expect(result.current.liked).toBe(true));
    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(api.unlike).toHaveBeenCalledWith(likedTrack.id));
    expect(api.like).not.toHaveBeenCalled();
  });

  it('likes a look-alike variant as its own track', async () => {
    const { result } = setup(variant);
    await waitFor(() => expect(api.listLikes).toHaveBeenCalled());
    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(api.like).toHaveBeenCalledWith(variant));
    expect(api.unlike).not.toHaveBeenCalled();
  });

  it('likes a track with no liked variant', async () => {
    const other = makeTrack({ id: 'youtube:c3', sourceId: 'c3', title: 'Second Wind' });
    const { result } = setup(other);
    await waitFor(() => expect(api.listLikes).toHaveBeenCalled());
    expect(result.current.liked).toBe(false);

    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(api.like).toHaveBeenCalledWith(other));
    expect(api.unlike).not.toHaveBeenCalled();
  });

  it('does nothing without a track', async () => {
    const { result } = setup(null);
    expect(result.current.liked).toBe(false);

    await act(async () => { result.current.toggle(); });
    expect(api.like).not.toHaveBeenCalled();
    expect(api.unlike).not.toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in instead of mutating', async () => {
    auth.user = null;
    const { result } = setup(variant);

    await act(async () => { result.current.toggle(); });
    expect(toast.message).toHaveBeenCalledWith('Sign in to like tracks', expect.anything());
    expect(api.like).not.toHaveBeenCalled();
    expect(api.unlike).not.toHaveBeenCalled();
  });
});


function tr(id: string, title: string): Track {
  return makeTrack({ id, sourceId: id.split(':').pop()!, title, artist: 'Artist' });
}
const slowed = tr('youtube:slow', 'maldito movimiento (Slowed)');
const superSlowed = tr('youtube:super', 'maldito movimiento (Super Slowed)');
const plain = tr('youtube:plain', 'Song');
const official = tr('youtube:vid', 'Song (Official Video)');

describe('the like rule is exact track id only', () => {
  beforeEach(() => { api.listLikes.mockResolvedValue({ tracks: [slowed, plain] }); });

  it('lights the heart for the exact liked id', async () => {
    const { result } = renderHook(() => useLikeToggle(slowed), { wrapper });
    await waitFor(() => expect(result.current.liked).toBe(true));
  });

  it('does not light "(Super Slowed)" when "(Slowed)" is liked', async () => {
    const { result } = renderHook(() => ({ a: useLikeToggle(slowed), b: useLikeToggle(superSlowed) }), { wrapper });
    await waitFor(() => expect(result.current.a.liked).toBe(true));
    expect(result.current.b.liked).toBe(false);
  });

  it('does not light "Song (Official Video)" when "Song" is liked', async () => {
    const { result } = renderHook(() => ({ a: useLikeToggle(plain), b: useLikeToggle(official) }), { wrapper });
    await waitFor(() => expect(result.current.a.liked).toBe(true));
    expect(result.current.b.liked).toBe(false);
  });

  it('toggling an unliked look-alike adds that track and removes nothing', async () => {
    const { result } = renderHook(() => useLikeRule(), { wrapper });
    await waitFor(() => expect(result.current.likedIds.size).toBe(2));
    await act(async () => { result.current.toggle(superSlowed); });
    await waitFor(() => expect(api.like).toHaveBeenCalledWith(superSlowed));
    expect(api.unlike).not.toHaveBeenCalled();
  });
});
