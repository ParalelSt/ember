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

// Bughunt V7: in the New playlist dialog (capped at 90% of the window) the
// recommended list ran under the footer and out of the dialog, because the
// box around it could not shrink. The list and its wrapper must be a
// shrinkable column.
describe('TrackSearchPicker in a height-capped dialog', () => {
  it('lets the recommended list shrink and scroll', async () => {
    setup([]);
    const row = await screen.findByText('Live Forever');
    const list = row.closest('.overflow-y-auto') as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.parentElement).toHaveClass('flex', 'min-h-0', 'flex-col');
    expect(list.parentElement!.parentElement).toHaveClass('min-h-0');
  });
});

describe('TrackSearchPicker Add and Added pills', () => {
  it('Add adds; with onRemove an Added pill takes the song out again', async () => {
    api.search.mockResolvedValue({ tracks: [inPlaylist[0], fresh] });
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TrackSearchPicker added={[inPlaylist[0]]} onAdd={onAdd} onRemove={onRemove} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('Search for songs to add…'), { target: { value: 'oasis' } });
    const added = await screen.findByRole('button', { name: 'Remove Wonderwall' }, { timeout: 2000 });
    expect(added).toHaveAttribute('aria-pressed', 'true');
    expect(added).toHaveTextContent('Added');
    fireEvent.click(added);
    expect(onRemove).toHaveBeenCalledWith(inPlaylist[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Live Forever' }));
    expect(onAdd).toHaveBeenCalledWith(fresh);
  });

  it('without onRemove the Added pill is only a marker', async () => {
    api.search.mockResolvedValue({ tracks: [inPlaylist[0]] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TrackSearchPicker added={[inPlaylist[0]]} onAdd={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('Search for songs to add…'), { target: { value: 'oasis' } });
    expect(await screen.findByRole('button', { name: 'Added' }, { timeout: 2000 })).toBeDisabled();
  });
});

describe('TrackSearchPicker recommendations seed', () => {
  // The server grows recommendations from a YouTube video only; any other id
  // gets today's chart under "Recommended for this playlist".
  const upload: Track = { ...song('upload:u1', 'Demo Take'), source: 'upload', sourceId: 'u1' };

  it('seeds from a YouTube song, not from an upload listed first', async () => {
    setup([upload, ...inPlaylist]);
    await screen.findByText('Live Forever');
    expect(api.getRecommended).toHaveBeenCalledWith('aaa');
  });

  it('with only uploads, asks for plain recommendations and says so', async () => {
    setup([upload]);
    await screen.findByText('Live Forever');
    expect(api.getRecommended).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });
});
