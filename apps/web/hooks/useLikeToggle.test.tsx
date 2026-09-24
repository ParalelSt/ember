import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLikeToggle } from './useLikeToggle';
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
// Same song, different upload: a variant that must count as liked.
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
  it('counts a variant of a liked song as liked', async () => {
    const { result } = setup(variant);
    await waitFor(() => expect(result.current.liked).toBe(true));
  });

  it('unlikes the existing entry when a variant is toggled', async () => {
    const { result } = setup(variant);
    await waitFor(() => expect(result.current.liked).toBe(true));

    await act(async () => { result.current.toggle(); });
    // The liked entry is the one removed, not the variant on screen, so a
    // song never ends up liked twice.
    await waitFor(() => expect(api.unlike).toHaveBeenCalledWith(likedTrack.id));
    expect(api.like).not.toHaveBeenCalled();
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

  // Bughunt X7: a quick double tap sent the like and the unlike together.
  // The unlike could reach the server first, find nothing to remove, and the
  // like then landed: the song stayed liked.
  it('a quick double tap waits for the like before sending the unlike', async () => {
    const fresh = makeTrack({ id: 'youtube:d4', sourceId: 'd4', title: 'Double Tap' });
    let serverLiked = false;
    let finishLike: () => void = () => {};
    let finishUnlike: () => void = () => {};
    api.listLikes.mockImplementation(async () => ({ tracks: serverLiked ? [fresh] : [] }));
    api.like.mockImplementation(() => new Promise((resolve) => {
      finishLike = () => { serverLiked = true; resolve({ ok: true }); };
    }));
    api.unlike.mockImplementation(() => new Promise((resolve) => {
      finishUnlike = () => { serverLiked = false; resolve({ ok: true }); };
    }));

    const { result } = setup(fresh);
    await waitFor(() => expect(api.listLikes).toHaveBeenCalled());
    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(result.current.liked).toBe(true));
    await act(async () => { result.current.toggle(); });
    await waitFor(() => expect(result.current.liked).toBe(false));

    // Both taps are in; only the like has gone out.
    await waitFor(() => expect(api.like).toHaveBeenCalledTimes(1));
    expect(api.unlike).not.toHaveBeenCalled();

    await act(async () => { finishLike(); });
    await waitFor(() => expect(api.unlike).toHaveBeenCalledWith(fresh.id));
    // The heart does not flash back to liked in between.
    expect(result.current.liked).toBe(false);

    await act(async () => { finishUnlike(); });
    await waitFor(() => expect(api.listLikes.mock.calls.length).toBeGreaterThan(1));
    expect(serverLiked).toBe(false);
    expect(result.current.liked).toBe(false);
  });
});
