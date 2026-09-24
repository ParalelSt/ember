import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Playlist, Track } from '@/types/track';
import type { CopyOutcome } from '@/lib/playlistCopy';

// The Copy to… bar with the library hooks faked: what the picker lists and
// counts, the Liked songs warning (nothing liked before "Like N songs"),
// the new-playlist path and the result line.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// base-ui's Popover and Dialog can't render under vitest here (see
// test-utils/popoverMock.tsx); the browser test drives the real ones.
vi.mock('@base-ui/react/popover', () => import('@/test-utils/popoverMock'));
vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));
vi.mock('@/components/ui/sheet', () => import('@/test-utils/dialogMock'));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

let desktop = true;
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop }));

function t(id: string, title: string, artist: string): Track {
  return { id, source: 'youtube', sourceId: id, title, artist, artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '' };
}

const SLOW = t('youtube:slow', 'Slow Static', 'Aftertone');
const HARBOR = t('youtube:harbor', 'Harbor Lights', 'Coastline');
const HOME = t('youtube:home', 'Home', 'Edward Sharpe');
const NORTH = t('youtube:north', 'Northbound', 'The Nulls');

let liked: Track[] = [];
let playlists: Playlist[] = [];
let lists = new Map<string, Track[]>();
const bulkAdd = vi.fn<(v: { id: string; tracks: Track[] }) => Promise<CopyOutcome>>();
const bulkLike = vi.fn<(tracks: Track[]) => Promise<CopyOutcome>>();
const createPlaylist = vi.fn<(name: string) => Promise<Playlist>>();
const deletePlaylist = vi.fn<(id: string) => Promise<unknown>>();

vi.mock('@/hooks/useLibrary', () => ({
  useQueryLikes: () => ({ data: liked }),
  useQueryPlaylists: () => ({ data: playlists }),
  useQueryPlaylistTracks: (ids: string[]) => new Map(ids.flatMap((id) => (lists.has(id) ? [[id, lists.get(id)!] as const] : []))),
  useExecuteBulkAddToPlaylist: () => ({ mutateAsync: bulkAdd }),
  useExecuteBulkLike: () => ({ mutateAsync: bulkLike }),
  useExecuteCreatePlaylist: () => ({ mutateAsync: createPlaylist }),
  useExecuteDeletePlaylist: () => ({ mutateAsync: deletePlaylist }),
}));

const { CopySongsBar } = await import('./CopySongsBar');

const pl = (id: string, name: string): Playlist => ({ id, name, created_at: '', artwork_url: null });

beforeEach(() => {
  desktop = true;
  liked = [SLOW, t('youtube:harborv', 'Harbor Lights (Official Video)', 'Coastline - Topic')];
  playlists = [pl('src', 'Road trip'), pl('gym', 'Gym'), pl('dad', 'For Dad')];
  lists = new Map([
    ['gym', [HOME]],
    ['dad', [t('youtube:home2', 'Home', 'Phillip Phillips')]],
  ]);
  for (const f of [bulkAdd, bulkLike, createPlaylist, deletePlaylist, toastError]) f.mockReset();
});

function Bar(props: Partial<ComponentProps<typeof CopySongsBar>>) {
  return (
    <CopySongsBar
      source={{ kind: 'playlist', id: 'src' }}
      selecting
      picked={[SLOW, HARBOR, HOME, NORTH]}
      onClear={() => {}}
      onDone={() => {}}
      {...props}
    />
  );
}

const openPicker = async () => {
  fireEvent.click(screen.getByTestId('copy-to'));
  return within(await screen.findByTestId('copy-destinations'));
};

const notes = () =>
  Object.fromEntries(
    screen.getAllByTestId('copy-destination').map((b) => [b.getAttribute('data-destination'), within(b).getByTestId('copy-destination-note').textContent]),
  );

describe('CopySongsBar', () => {
  it('shows the count, and nothing when not selecting and nothing was copied', () => {
    const { rerender } = render(<Bar />);
    expect(screen.getByTestId('copy-count')).toHaveTextContent('4 selected');
    rerender(<Bar picked={[]} />);
    expect(screen.getByTestId('copy-count')).toHaveTextContent('Pick songs to copy');
    expect(screen.getByTestId('copy-to')).toBeDisabled();
    rerender(<Bar selecting={false} />);
    expect(screen.queryByTestId('copy-bar')).toBeNull();
  });

  it('lists New playlist, Liked songs, then the playlists without the source, each with what is already there', async () => {
    render(<Bar />);
    await openPicker();
    const ids = screen.getAllByTestId('copy-destination').map((b) => b.getAttribute('data-destination'));
    expect(ids).toEqual(['new', 'liked', 'gym', 'dad']);
    expect(notes()).toEqual({
      new: 'With these 4 songs',
      liked: '2 already liked, 2 to add',
      gym: '1 already there, 3 to add',
      // A different "Home": not a duplicate.
      dad: '0 already there, 4 to add',
    });
  });

  it('a playlist still loading says so; one that has every song cannot be picked', async () => {
    lists.delete('dad');
    lists.set('gym', [SLOW, HARBOR, HOME, NORTH]);
    render(<Bar />);
    await openPicker();
    expect(notes().dad).toBe('Checking…');
    expect(notes().gym).toBe('All 4 already there');
    expect(screen.getAllByTestId('copy-destination').find((b) => b.getAttribute('data-destination') === 'gym')).toBeDisabled();
  });

  it('copies to a playlist and shows what the server did, with Which?', async () => {
    bulkAdd.mockResolvedValue({
      added: 3,
      skipped: [{ id: HOME.id, title: 'Home', artist: 'Edward Sharpe', reason: 'same-track', existingTitle: 'Home' }],
    });
    const onDone = vi.fn();
    const { rerender } = render(<Bar onDone={onDone} />);
    const list = await openPicker();
    fireEvent.click(list.getByText('Gym'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(bulkAdd).toHaveBeenCalledWith({ id: 'gym', tracks: [SLOW, HARBOR, HOME, NORTH] });
    rerender(<Bar onDone={onDone} selecting={false} picked={[]} />);
    expect(screen.getByTestId('copy-result-line')).toHaveTextContent('Added 3, skipped 1 already there');
    expect(screen.getByTestId('copy-result')).toHaveTextContent('In Gym');
    expect(screen.getByTestId('copy-open')).toHaveAttribute('href', '/playlist/gym');
    expect(screen.queryByTestId('copy-skipped')).toBeNull();
    fireEvent.click(screen.getByTestId('copy-which'));
    expect(screen.getByTestId('copy-skipped')).toHaveTextContent('Home · Edward Sharpe: already there');
    // Selecting again starts over.
    rerender(<Bar onDone={onDone} />);
    expect(screen.queryByTestId('copy-result')).toBeNull();
  });

  it('Liked songs warns first: nothing is liked until "Like N songs", and Cancel likes nothing', async () => {
    render(<Bar />);
    const list = await openPicker();
    fireEvent.click(list.getByText('Liked songs'));
    const warning = await screen.findByTestId('copy-liked-confirm');
    expect(warning).toHaveTextContent('Adding songs to Liked songs likes every one of them');
    expect(warning).toHaveTextContent('2 are already liked, so 2 songs get a new like.');
    expect(within(warning).getByTestId('copy-liked-yes')).toHaveTextContent('Like 2 songs');
    expect(bulkLike).not.toHaveBeenCalled();
    fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('copy-liked-confirm')).toBeNull());
    expect(bulkLike).not.toHaveBeenCalled();
  });

  it('confirming likes the picked songs and reports it', async () => {
    bulkLike.mockResolvedValue({
      added: 2,
      skipped: [
        { id: SLOW.id, title: 'Slow Static', artist: 'Aftertone', reason: 'same-track', existingTitle: 'Slow Static' },
        { id: HARBOR.id, title: 'Harbor Lights', artist: 'Coastline', reason: 'other-version', existingTitle: 'Harbor Lights (Official Video)' },
      ],
    });
    const onDone = vi.fn();
    const { rerender } = render(<Bar onDone={onDone} />);
    fireEvent.click((await openPicker()).getByText('Liked songs'));
    fireEvent.click(await screen.findByTestId('copy-liked-yes'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bulkLike).toHaveBeenCalledWith([SLOW, HARBOR, HOME, NORTH]);
    rerender(<Bar onDone={onDone} selecting={false} picked={[]} />);
    expect(screen.getByTestId('copy-result-line')).toHaveTextContent('Added 2, skipped 2 already there');
    expect(screen.getByTestId('copy-result')).toHaveTextContent('every added song now has its heart');
    fireEvent.click(screen.getByTestId('copy-which'));
    expect(screen.getByTestId('copy-skipped')).toHaveTextContent('Harbor Lights · Coastline: already there as "Harbor Lights (Official Video)"');
  });

  it('with one already liked the warning says "is", and when all are liked Liked songs cannot be picked', async () => {
    liked = [SLOW];
    const { unmount } = render(<Bar picked={[SLOW, NORTH]} />);
    fireEvent.click((await openPicker()).getByText('Liked songs'));
    expect(await screen.findByTestId('copy-liked-already')).toHaveTextContent('1 is already liked, so 1 song gets a new like.');
    unmount();
    render(<Bar picked={[SLOW]} />);
    await openPicker();
    expect(notes().liked).toBe('Already liked');
  });

  it('the Liked songs page does not offer Liked songs as a destination', async () => {
    render(<Bar source={{ kind: 'liked' }} />);
    await openPicker();
    expect(screen.getAllByTestId('copy-destination').map((b) => b.getAttribute('data-destination'))).toEqual(['new', 'src', 'gym', 'dad']);
  });

  it('a new playlist is named inline, made, then filled', async () => {
    createPlaylist.mockResolvedValue(pl('fresh', 'Summer'));
    bulkAdd.mockResolvedValue({ added: 4, skipped: [] });
    const onDone = vi.fn();
    const { rerender } = render(<Bar onDone={onDone} />);
    fireEvent.click((await openPicker()).getByText('New playlist'));
    const input = screen.getByLabelText('New playlist name');
    fireEvent.change(input, { target: { value: 'Summer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createPlaylist).toHaveBeenCalledWith('Summer');
    expect(bulkAdd).toHaveBeenCalledWith({ id: 'fresh', tracks: [SLOW, HARBOR, HOME, NORTH] });
    rerender(<Bar onDone={onDone} selecting={false} picked={[]} />);
    expect(screen.getByTestId('copy-result-line')).toHaveTextContent('Added 4');
    expect(screen.getByTestId('copy-open')).toHaveAttribute('href', '/playlist/fresh');
  });

  it('a new playlist whose copy fails is removed again, and the member is told', async () => {
    createPlaylist.mockResolvedValue(pl('fresh', 'Summer'));
    bulkAdd.mockRejectedValue(new Error('boom'));
    deletePlaylist.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<Bar onDone={onDone} />);
    fireEvent.click((await openPicker()).getByText('New playlist'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });
    await waitFor(() => expect(deletePlaylist).toHaveBeenCalledWith('fresh'));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('the new playlist was removed'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('on a phone the picker and the warning are sheets', async () => {
    desktop = false;
    render(<Bar />);
    fireEvent.click(screen.getByTestId('copy-to'));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveTextContent('Copy 4 songs to');
    fireEvent.click(within(sheet).getByText('Liked songs'));
    expect(await screen.findByTestId('copy-liked-confirm')).toBeInTheDocument();
    expect(bulkLike).not.toHaveBeenCalled();
  });
});
