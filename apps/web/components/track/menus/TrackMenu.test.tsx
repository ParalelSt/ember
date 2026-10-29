import type { MenuAction } from '@/components/ui/action-sheet';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

const playTrack = vi.fn();
const toastSuccess = vi.fn();

// The menu itself (dropdown or phone sheet) is AddToPlaylistMenu's; here it
// just lists the actions TrackMenu hands it.
vi.mock('./AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ actions, footer }: { actions?: MenuAction[]; footer?: MenuAction }) => (
    <div>
      <button type="button">{actions?.length ? 'More' : 'Add to playlist'}</button>
      <div role="menu">
        {[...(actions ?? []), ...(footer ? [{ ...footer, key: `footer-${footer.key}` }] : [])].map((a) => (
          <div key={a.key} role="menuitem" data-key={a.key} data-destructive={a.destructive ? 'true' : undefined} onClick={a.onSelect}>
            {a.label}
          </div>
        ))}
      </div>
    </div>
  ),
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ playTrack }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string, o?: unknown) => toastSuccess(m, o) } }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const blocking = vi.hoisted(() => ({ ids: new Set<string>(), block: vi.fn(async () => {}), unblock: vi.fn(async () => {}) }));
vi.mock('@/hooks/useBlockedTracks', () => ({
  useBlockedTracks: () => ({
    isBlocked: (t: { id: string }) => blocking.ids.has(t.id),
    block: blocking.block,
    unblock: blocking.unblock,
  }),
}));

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
  blocking.ids.clear();
  blocking.block.mockClear();
  blocking.unblock.mockClear();
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
    expect(toastSuccess).toHaveBeenCalledWith('Added "Song" to the queue', undefined);
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

describe('TrackMenu block (owner request 2026-10-22)', () => {
  it('Block song blocks it and offers Undo', async () => {
    render(<TrackMenu track={track} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Block song' }));
    expect(blocking.block).toHaveBeenCalledWith(track);
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toMatch(/won't come up in radio, mixes or suggestions/);
    options.action.onClick();
    expect(blocking.unblock).toHaveBeenCalledWith(track);
  });

  it('a blocked song offers Unblock song instead', () => {
    blocking.ids.add(track.id);
    render(<TrackMenu track={track} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unblock song' }));
    expect(blocking.unblock).toHaveBeenCalledWith(track);
    expect(blocking.block).not.toHaveBeenCalled();
  });
});

describe('TrackMenu Remove (recent searches, /dizajn R1-R4)', () => {
  const keys = () => screen.getAllByRole('menuitem').map((m) => m.getAttribute('data-key'));
  const removeItem = () => screen.getByRole('menuitem', { name: 'Remove from recent searches' });

  for (const [style, place, red] of [
    ['R1', 'last', false],
    ['R2', 'last', true],
    ['R3', 'first', false],
    ['R4', 'footer', true],
  ] as const) {
    it(`${style}: Remove is ${place}${red ? ', in red' : ''}, and runs onRemove`, () => {
      const onRemove = vi.fn();
      render(<TrackMenu track={track} onRemove={onRemove} removeLabel="Remove from recent searches" removeStyle={style} />);
      const k = keys();
      if (place === 'first') expect(k[0]).toBe('remove');
      if (place === 'last') expect(k[k.length - 1]).toBe('remove');
      if (place === 'footer') expect(k[k.length - 1]).toBe('footer-remove');
      expect(removeItem().getAttribute('data-destructive')).toBe(red ? 'true' : null);
      fireEvent.click(removeItem());
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  }

  it('offers no Remove when the row has nothing to remove', () => {
    render(<TrackMenu track={track} />);
    expect(screen.queryByRole('menuitem', { name: /Remove/ })).toBeNull();
  });
});

it("owner's pick: without a style, Remove is the last item, plain, with an X (R1)", () => {
  render(<TrackMenu track={track} onRemove={vi.fn()} removeLabel="Remove from recent searches" />);
  const items = screen.getAllByRole('menuitem');
  expect(items[items.length - 1].getAttribute('data-key')).toBe('remove');
  expect(items[items.length - 1].getAttribute('data-destructive')).toBeNull();
});
