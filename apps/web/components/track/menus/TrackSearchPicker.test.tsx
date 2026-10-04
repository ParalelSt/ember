import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlaybackContext, Track } from '@/types/track';
import { isExcluded } from '@/lib/trackIdentity';

// The "Recommended for this playlist" list under a playlist (bug report
// 2026-10-02): it never shows a song the playlist already has, and playing
// one of its songs hands radio the playlist's songs to skip, so the queue
// it builds does not bring them back.

const player = vi.hoisted(() => ({ playTrack: vi.fn(), toggle: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, playTrack: player.playTrack, toggle: player.toggle }),
}));
vi.mock('@/components/track/TrackRow', () => ({
  TrackRow: ({ track, trailing }: { track: Track; trailing?: ReactNode }) => (
    <div data-testid="row" data-id={track.id}>
      <span>{track.title}</span>
      {trailing}
    </div>
  ),
}));
const api = vi.hoisted(() => ({ getRecommended: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const { TrackSearchPicker } = await import('./TrackSearchPicker');

const song = (id: string, title: string, artist = 'Band'): Track => ({
  id,
  source: 'youtube',
  sourceId: id.split(':').pop() ?? id,
  title,
  artist,
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});

const inPlaylist = [song('youtube:aaa', 'Wonderwall', 'Oasis'), song('youtube:bbb', "Don't Look Back in Anger", 'Oasis')];
const fresh = song('youtube:new', 'Live Forever', 'Oasis');

function setup(added: Track[] = inPlaylist) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TrackSearchPicker added={added} seeds={added} onAdd={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getRecommended.mockResolvedValue({
    tracks: [
      // The same song as a playlist row, under a doubled id prefix.
      song('youtube:youtube:aaa', 'Wonderwall', 'Oasis'),
      // Another upload of a playlist song.
      song('youtube:bbb-video', "Don't Look Back in Anger (Official Video)", 'Oasis'),
      fresh,
    ],
  });
});

describe('TrackSearchPicker recommendations under a playlist', () => {
  it('shows only songs the playlist does not have yet', async () => {
    setup();
    await screen.findByText('Live Forever');
    expect(screen.getAllByTestId('row').map((r) => r.getAttribute('data-id'))).toEqual(['youtube:new']);
  });

  it('playing one starts radio that skips the playlist\'s songs', async () => {
    setup();
    const row = (await screen.findByText('Live Forever')).closest('[data-testid="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Play' }));
    expect(player.playTrack).toHaveBeenCalledTimes(1);
    const [played, list, context] = player.playTrack.mock.calls[0] as [Track, Track[] | undefined, PlaybackContext];
    expect(played.id).toBe('youtube:new');
    expect(list).toBeUndefined();
    expect(context.type).toBe('single');
    const exclude = new Set(context.type === 'single' ? context.exclude ?? [] : []);
    // Every playlist song, in any spelling or version, is on the skip list;
    // the song being played and new ones are not.
    expect(isExcluded(song('youtube:youtube:aaa', 'x', 'y'), exclude)).toBe(true);
    expect(isExcluded(song('youtube:bbb-live', "Don't Look Back in Anger [Lyrics]", 'Oasis'), exclude)).toBe(true);
    expect(isExcluded(fresh, exclude)).toBe(false);
  });

  it('with nothing added, plays with an empty skip list', async () => {
    api.getRecommended.mockResolvedValue({ tracks: [fresh] });
    setup([]);
    const row = (await screen.findByText('Live Forever')).closest('[data-testid="row"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Play' }));
    expect(player.playTrack).toHaveBeenCalledWith(fresh, undefined, { type: 'single', exclude: [] });
  });
});
