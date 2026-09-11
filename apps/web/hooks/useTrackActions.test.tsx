import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTrackActions } from './useTrackActions';
import { songKey } from '@/lib/songKey';
import type { Track } from '@/types/track';

const player = vi.hoisted(() => ({
  current: null as Track | null,
  isPlaying: false,
  playTrack: vi.fn(),
  toggle: vi.fn(),
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

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

function setup() {
  return renderHook(() => useTrackActions(), { wrapper });
}

beforeEach(() => {
  player.current = null;
  player.isPlaying = false;
  auth.user = { id: 'u1' };
  vi.clearAllMocks();
  api.listLikes.mockResolvedValue({ tracks: [likedTrack] });
  api.like.mockResolvedValue({ ok: true });
  api.unlike.mockResolvedValue({ ok: true });
});

describe('useTrackActions', () => {
  it('reports the player state', async () => {
    player.current = variant;
    player.isPlaying = true;
    const { result } = setup();
    expect(result.current.currentId).toBe('youtube:b2');
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.onPlay).toBe(player.playTrack);

    result.current.onToggle();
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  it('reports no current track when nothing is playing', () => {
    const { result } = setup();
    expect(result.current.currentId).toBeNull();
  });

  it('puts both the liked id and its song key in likedIds, so variants count as liked', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.likedIds.size).toBe(2));
    expect(result.current.likedIds.has(likedTrack.id)).toBe(true);
    expect(result.current.likedIds.has(songKey(variant))).toBe(true);
    expect(result.current.likedIds.has(variant.id)).toBe(false);
  });

  it('unlikes the existing entry when a variant of a liked song is toggled', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.likedIds.size).toBe(2));

    await act(async () => { result.current.onLike(variant); });
    // The liked entry is the one that gets removed, not the variant that
    // was clicked, so a song never ends up liked twice.
    await waitFor(() => expect(api.unlike).toHaveBeenCalledWith(likedTrack.id));
    expect(api.like).not.toHaveBeenCalled();
  });

  it('likes a track that has no liked variant yet', async () => {
    const other = makeTrack({ id: 'youtube:c3', sourceId: 'c3', title: 'Second Wind' });
    const { result } = setup();
    await waitFor(() => expect(result.current.likedIds.size).toBe(2));

    await act(async () => { result.current.onLike(other); });
    await waitFor(() => expect(api.like).toHaveBeenCalledWith(other));
    expect(api.unlike).not.toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in instead of mutating', async () => {
    auth.user = null;
    const { result } = setup();

    await act(async () => { result.current.onLike(variant); });
    expect(toast.message).toHaveBeenCalledWith('Sign in to like tracks', expect.anything());
    expect(api.like).not.toHaveBeenCalled();
    expect(api.unlike).not.toHaveBeenCalled();
  });
});
