import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { tt } from '@/test-utils/mixTracks';

const state = vi.hoisted(() => ({
  mix: null as null | Record<string, unknown>,
  error: null as unknown,
  mutate: vi.fn(),
  playbackFor: null as unknown,
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: React.ComponentProps<'a'>) => <a href={href} {...r}>{children}</a> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/track/menus/TrackMenu', () => ({ renderTrackMenu: () => null }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryMix: () => ({ data: state.mix ?? undefined, isLoading: !state.mix && !state.error, error: state.error, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useTrackActions', () => ({
  useTrackActions: () => ({ currentId: null, isPlaying: false, likedIds: new Set(), onPlay: vi.fn(), onToggle: vi.fn(), onLike: vi.fn(), artFiles: {} }),
}));
vi.mock('@/hooks/useCollectionPlayback', () => ({
  useCollectionPlayback: (_t: unknown, context: unknown) => {
    state.playbackFor = context;
    return { play: vi.fn(), shuffle: vi.fn(), shuffleOn: false, active: false };
  },
}));
vi.mock('@/hooks/useSaveAsPlaylist', () => ({ useSaveAsPlaylist: () => ({ mutate: state.mutate, isPending: false }) }));

import Page from './page';

async function open(key: string) {
  await act(async () => {
    render(<Suspense fallback={null}><Page params={Promise.resolve({ key })} /></Suspense>);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.error = null;
  state.mix = {
    key: 'rock-metal', title: 'Rock & Metal', subtitle: 'Gojira, Tool, Metallica and more',
    cover: { artworkUrls: ['/a.jpg'], color: '#f2b8a8' }, builtAt: new Date().toISOString(),
    tracks: [tt('a1', 'Gojira'), tt('a2', 'Tool'), tt('a3', 'Metallica')],
  };
});

describe('/mix/[key]', () => {
  it('shows the mix with its built line, songs and a mix playback context', async () => {
    await open('rock-metal');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rock & Metal Mix');
    expect(screen.getByTestId('mix-built').textContent).toBe('Built today from Gojira, Tool, Metallica');
    expect(screen.getByTestId('collection-meta').textContent).toBe('3 songs · Rebuilt every night');
    expect(screen.getAllByText('Gojira a1')[0]).toBeInTheDocument();
    expect(state.playbackFor).toEqual({ type: 'mix', mixKey: 'rock-metal', mixTitle: 'Rock & Metal Mix' });
  });

  it('saves the mix as a playlist', async () => {
    await open('rock-metal');
    fireEvent.click(screen.getByTestId('save-as-playlist'));
    const [{ name, tracks }] = state.mutate.mock.calls[0];
    expect(name).toMatch(/^Rock & Metal mix, \d{1,2} \w{3}$/);
    expect(tracks).toHaveLength(3);
  });

  it('a mix that is not yours (or gone) is not found', async () => {
    state.mix = null;
    state.error = Object.assign(new Error('Mix not found'), { status: 404 });
    await open('balkan');
    expect(screen.getByText('Mix not found.')).toBeInTheDocument();
  });

  it('an artist mix: "Artist mix" over "Gojira Mix", rebuilt every night', async () => {
    state.mix = { ...state.mix!, key: 'artist-gojira', kind: 'artist', title: 'Gojira' };
    await open('artist-gojira');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Gojira Mix');
    expect(screen.getByText('Artist mix')).toBeInTheDocument();
    expect(screen.getByTestId('collection-meta').textContent).toBe('3 songs · Rebuilt every night');
    expect(state.playbackFor).toEqual({ type: 'mix', mixKey: 'artist-gojira', mixTitle: 'Gojira Mix' });
  });

  it('Discover: "Discover" over "New to you", new every Monday, saved as "New to you mix"', async () => {
    state.mix = { ...state.mix!, key: 'discover', kind: 'discover', title: 'New to you' };
    await open('discover');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New to you');
    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(screen.getByTestId('collection-meta').textContent).toBe('3 songs · New every Monday');
    fireEvent.click(screen.getByTestId('save-as-playlist'));
    expect(state.mutate.mock.calls[0][0].name).toMatch(/^New to you mix, \d{1,2} \w{3}$/);
  });

  it('On repeat and Throwback keep their own names', async () => {
    state.mix = { ...state.mix!, key: 'throwback', title: 'Back again' };
    await open('throwback');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Back again');
    expect(screen.getByText('Throwback')).toBeInTheDocument();
  });
});
