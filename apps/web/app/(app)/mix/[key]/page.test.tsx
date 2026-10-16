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
    expect(screen.getByText('Gojira a1')).toBeInTheDocument();
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
});
