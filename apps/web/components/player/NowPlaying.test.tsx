import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Track } from '@/types/track';
import { NowPlaying } from './NowPlaying';
import { usePlayerStore } from '@/stores/usePlayerStore';

// The phone bar keeps only play/pause, so the full-screen view is where a
// phone reaches previous, next and the queue. These pin that they are here.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

const TRACK: Track = {
  id: 't1',
  source: 'youtube',
  sourceId: 'v1',
  title: 'Copper Sky',
  artist: 'Coastline',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 180,
  artworkUrl: null,
  streamUrl: '/x',
};
const player = vi.hoisted(() => ({ toggle: vi.fn(), next: vi.fn(), prev: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({
    current: TRACK,
    isPlaying: true,
    position: 0,
    duration: 180,
    toggle: player.toggle,
    next: player.next,
    prev: player.prev,
    seek: () => {},
  }),
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLikeToggle', () => ({ useLikeToggle: () => ({ liked: false, toggle: () => {} }) }));
vi.mock('@/lib/offlineNative', () => ({ useTrackArtSrc: () => null }));
vi.mock('@/lib/useBackDismiss', () => ({ useBackDismiss: () => {} }));
// The sheet itself is QueueSheet's business: here it only has to be told to open.
vi.mock('@/components/player/QueueSheet', () => ({
  QueueSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="queue-sheet" /> : null),
}));
const Stub = vi.hoisted(() => () => null);
vi.mock('@/components/player/SeekBar', () => ({ SeekBar: Stub }));
vi.mock('@/components/player/LyricsBody', () => ({ LyricsBody: Stub }));
vi.mock('@/components/player/NowPlayingSummary', () => ({ NowPlayingSummary: Stub }));

beforeEach(() => {
  player.toggle.mockReset();
  player.next.mockReset();
  player.prev.mockReset();
  usePlayerStore.getState().setNowPlayingOpen(true);
});

describe('NowPlaying', () => {
  it('has previous, play/pause and next, and they work', () => {
    render(<NowPlaying />);
    const view = screen.getByTestId('now-playing');
    fireEvent.click(within(view).getByRole('button', { name: 'Previous' }));
    fireEvent.click(within(view).getByRole('button', { name: 'Pause' }));
    fireEvent.click(within(view).getByRole('button', { name: 'Next' }));
    expect([player.prev, player.toggle, player.next].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('has a Queue button that opens the queue sheet', () => {
    render(<NowPlaying />);
    expect(screen.queryByTestId('queue-sheet')).toBeNull();
    fireEvent.click(within(screen.getByTestId('now-playing')).getByRole('button', { name: 'Queue' }));
    expect(screen.getByTestId('queue-sheet')).toBeInTheDocument();
    // The view stays open underneath: the sheet is on top of it.
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
  });

  // Bughunt V6: the top buttons floated (absolute, no background) over a
  // scroller that filled the whole sheet, so scrolled content slid under
  // them. They now sit in a row of their own, and the scroller only takes
  // the space below it (the overlap itself is measured in a real browser by
  // tests/layout-v6-nowplaying-header.test.mjs).
  it('keeps Close and Queue in a row above the scroller, not floating over it', () => {
    render(<NowPlaying />);
    const view = screen.getByTestId('now-playing');
    const scroller = view.querySelector('.overflow-y-auto') as HTMLElement;
    expect(scroller).toHaveClass('min-h-0', 'flex-1');
    for (const name of ['Close', 'Queue']) {
      const button = within(view).getByRole('button', { name });
      expect(scroller.contains(button)).toBe(false);
      expect(button).not.toHaveClass('absolute');
      // The row comes before the scroller in the sheet's column.
      expect(button.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const row = within(view).getByRole('button', { name: 'Close' }).parentElement!;
    expect(row).toHaveClass('flex', 'shrink-0');
    expect(row).not.toHaveClass('absolute');
  });
});
