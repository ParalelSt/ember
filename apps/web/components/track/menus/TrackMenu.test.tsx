import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

const playTrack = vi.fn();
const toastSuccess = vi.fn();

vi.mock('./AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ more }: { more?: ReactNode }) => (
    <div>
      <button type="button">{more ? 'More' : 'Add to playlist'}</button>
      <div role="menu">{more}</div>
    </div>
  ),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ playTrack }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m) } }));

const { TrackMenu } = await import('./TrackMenu');
const { usePlayerStore } = await import('@/stores/usePlayerStore');

const make = (id: string): Track => ({
  id,
  source: 'youtube',
  sourceId: id,
  title: id === 'youtube:abcdefghijk' ? 'Song' : id,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 1,
  artworkUrl: null,
  streamUrl: '',
});
const track = make('youtube:abcdefghijk');

beforeEach(() => {
  playTrack.mockReset();
  toastSuccess.mockReset();
  usePlayerStore.setState({ queue: [], index: -1, baseCount: 0 });
});

describe('TrackMenu add to queue', () => {
  it('the row menu is a More menu that offers "Add to queue"', () => {
    render(<TrackMenu track={track} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Add to queue/ })).toBeInTheDocument();
  });

  it('puts the song after the one playing and says so', () => {
    usePlayerStore.setState({ queue: [make('a'), make('b')], index: 0, baseCount: 2 });
    render(<TrackMenu track={track} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to queue/ }));
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['a', track.id, 'b']);
    expect(usePlayerStore.getState().baseCount).toBe(3);
    expect(toastSuccess).toHaveBeenCalledWith('Added "Song" to the queue');
    expect(playTrack).not.toHaveBeenCalled();
  });

  it('with nothing loaded, the song plays instead', () => {
    render(<TrackMenu track={track} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to queue/ }));
    expect(playTrack).toHaveBeenCalledWith(track, [track]);
  });
});

describe('TrackMenu re-match', () => {
  it('an imported track offers "Wrong song? Re-match" in the same menu', () => {
    const onRematch = vi.fn();
    render(<TrackMenu track={track} onRematch={onRematch} />);
    expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: /Wrong song\? Re-match/ }));
    expect(onRematch).toHaveBeenCalledTimes(1);
  });

  it('any other track has no re-match item', () => {
    render(<TrackMenu track={track} />);
    expect(screen.queryByText(/Re-match/)).toBeNull();
  });
});

describe('TrackMenu and reordering', () => {
  it('has no Move up / Move down: Edit order in the list toolbar replaces them', () => {
    render(<TrackMenu track={track} onRematch={vi.fn()} />);
    expect(screen.queryByRole('menuitem', { name: /Move (up|down)/ })).toBeNull();
  });
});

describe('TrackMenu on a song that is gone', () => {
  const gone: Track = { ...track, unavailableAt: '2026-10-01T10:00:00Z', unavailableReason: 'removed' };

  it('keeps Share in More without offering queue for an unavailable song', () => {
    render(<TrackMenu track={gone} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add to queue/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeInTheDocument();
  });

  it('a song that plays keeps Share everywhere', () => {
    render(<TrackMenu track={track} />);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeInTheDocument();
  });
});


it('shares the song URL through the same clipboard action as ShareButton', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<TrackMenu track={track} />);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/track/${track.sourceId}`);
  vi.unstubAllGlobals();
});

it('does not offer sharing for sources without a stable share URL', () => {
  render(<TrackMenu track={{ ...track, source: 'jamendo' }} />);
  expect(screen.queryByRole('menuitem', { name: 'Share' })).toBeNull();
});
