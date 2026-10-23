import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

const state = vi.hoisted(() => ({
  /** The seed Home asked recommendations for. */
  seed: undefined as string | undefined,
  history: [] as Track[],
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/FriendsListening', () => ({ FriendsListening: () => null }));
vi.mock('@/components/track/TrackShelf', () => ({ TrackShelf: ({ title }: { title: string }) => <h2>{title}</h2> }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: state.history }),
  useQueryLikes: () => ({ data: [] }),
  useQueryTrending: () => ({ data: [], isLoading: false }),
  useQueryRecommended: (seed: string | undefined) => {
    state.seed = seed;
    return { data: [], isLoading: false };
  },
}));
vi.mock('@/stores/useUiStore', () => ({
  useUiStore: (sel: (s: { lyricsOpen: boolean }) => unknown) => sel({ lyricsOpen: false }),
}));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }),
}));

const { default: HomePage } = await import('./page');

const yt = (n: number): Track =>
  ({ id: `youtube:hist${n}`, source: 'youtube', sourceId: `hist${n}`, title: `hist song ${n}`, artist: 'A' }) as Track;
const upload = (n: number): Track =>
  ({ id: `upload:u${n}`, source: 'upload', sourceId: 'abcdefghijklmno', title: `My demo ${n}`, artist: 'Me' }) as Track;

beforeEach(() => {
  state.seed = undefined;
  state.history = [];
});

describe('Because you played: the seed', () => {
  // Only a YouTube video can seed radio: an upload's id made the server
  // answer today's chart, shown as "Because you played <your upload>".
  it('grows from the last YouTube song played, not an upload played after it', () => {
    state.history = [upload(0), yt(0), yt(1)];
    render(<HomePage />);
    expect(state.seed).toBe('hist0');
    expect(screen.getByRole('heading', { name: 'Because you played "hist song 0"' })).toBeInTheDocument();
    expect(screen.queryByText(/Because you played "My demo/)).toBeNull();
  });

  it('with only uploads played, asks for nothing and shows no Because you played', () => {
    state.history = [upload(0), upload(1)];
    render(<HomePage />);
    expect(state.seed).toBeUndefined();
    expect(screen.queryByText(/Because you played/)).toBeNull();
  });
});
