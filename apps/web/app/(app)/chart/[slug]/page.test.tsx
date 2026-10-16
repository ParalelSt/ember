import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

const track = (i: number): Track => ({
  id: `youtube:rock000000${i}`, source: 'youtube', sourceId: `rock000000${i}`, title: `Rock song ${i}`, artist: `Band ${i}`,
  artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: `/art/${i}.jpg`, streamUrl: '',
});

const state = vi.hoisted(() => ({
  chart: null as null | { slug: string; title: string; color: string; fetchedAt: string | null; stale: boolean; tracks: unknown[] },
  error: null as unknown,
  mutate: vi.fn(),
  play: vi.fn(),
  shuffle: vi.fn(),
  playbackFor: null as unknown,
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: React.ComponentProps<'a'>) => <a href={href} {...r}>{children}</a> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/track/menus/TrackMenu', () => ({ renderTrackMenu: () => null }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryChart: () => ({ data: state.chart ?? undefined, isLoading: !state.chart && !state.error, error: state.error, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useTrackActions', () => ({
  useTrackActions: () => ({ currentId: null, isPlaying: false, likedIds: new Set(), onPlay: vi.fn(), onToggle: vi.fn(), onLike: vi.fn(), artFiles: {} }),
}));
vi.mock('@/hooks/useCollectionPlayback', () => ({
  useCollectionPlayback: (_tracks: unknown, context: unknown) => {
    state.playbackFor = context;
    return { play: state.play, shuffle: state.shuffle, shuffleOn: false, active: false };
  },
}));
vi.mock('@/hooks/useSaveAsPlaylist', () => ({ useSaveAsPlaylist: () => ({ mutate: state.mutate, isPending: false }) }));

import Page from './page';

async function open(slug: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <Page params={Promise.resolve({ slug })} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.error = null;
  state.chart = { slug: 'rock', title: 'Rock', color: '#b3261e', fetchedAt: '2026-10-16T08:00:00Z', stale: false, tracks: [1, 2, 3, 4, 5].map(track) };
});

describe('/chart/[slug]', () => {
  it('shows the chart ranked, with Play, Shuffle and a chart playback context', async () => {
    await open('rock');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rock');
    expect(screen.getByText('Chart')).toBeInTheDocument();
    expect(screen.getByTestId('collection-meta').textContent).toBe('5 songs · Updated daily');
    expect(screen.getByText('Rock song 1')).toBeInTheDocument();
    expect(state.playbackFor).toEqual({ type: 'chart', chartSlug: 'rock', chartTitle: 'Rock' });
    // The hero is a mosaic of the top four covers.
    expect(document.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
  });

  it('says how old a stale chart is', async () => {
    state.chart!.stale = true;
    state.chart!.fetchedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await open('rock');
    expect(screen.getByTestId('collection-meta').textContent).toBe('5 songs · Updated 3 hours ago');
  });

  it('saves today\'s songs as a playlist named after the chart', async () => {
    await open('rock');
    fireEvent.click(screen.getByTestId('save-as-playlist'));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    const [{ name, tracks }] = state.mutate.mock.calls[0];
    expect(name).toMatch(/^Rock chart, \d{1,2} \w{3}$/);
    expect(tracks).toHaveLength(5);
  });

  it('says a missing chart is not found', async () => {
    state.chart = null;
    state.error = Object.assign(new Error('Chart not found'), { status: 404 });
    await open('nope');
    expect(screen.getByText('Chart not found.')).toBeInTheDocument();
  });
});
