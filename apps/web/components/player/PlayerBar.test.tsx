import type { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PlayerBar } from './PlayerBar';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { Track } from '@/types/track';

const TRACK: Track = {
  id: 't1',
  source: 'youtube',
  sourceId: 'v1',
  title: 'Yes Sir, I Can Boogie',
  artist: 'Baccara',
  artistId: 'a1',
  album: 'Baccara',
  albumId: 'al1',
  durationSec: 264,
  artworkUrl: 'https://example.test/art.jpg',
  streamUrl: 'https://example.test/s.mp3',
};

// Everything the bar reads that is not the bar: the player, the account, the
// like state and the two menus/sheets that open portals. The subject here is
// the bar's own geometry.
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({
    current: TRACK,
    isPlaying: true,
    position: 92,
    duration: 264,
    volume: 0.5,
    toggle: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
  }),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false } }),
}));
vi.mock('@/hooks/useLikeToggle', () => ({ useLikeToggle: () => ({ liked: false, toggle: vi.fn() }) }));
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({ AddToPlaylistMenu: () => null }));
vi.mock('@/components/track/ShareButton', () => ({ ShareButton: () => null }));
vi.mock('@/components/player/QueueSheet', () => ({ QueueSheet: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));
// next/link reads the app router context, which no test renders.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// base-ui's Slider reaches the repo root's hoisted React 18 through its own
// copy and cannot render under happy-dom (see SeekBar.test.tsx).
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ className }: { className?: string }) => (
    <input type="range" aria-label="progress" className={className} readOnly />
  ),
}));

const phoneBar = () => screen.getByTestId('phone-player-bar');
const desktopBar = () => screen.getByTestId('desktop-player-bar');

beforeEach(() => {
  useSettingsStore.setState({ tabsEnabled: true, partyVolume: false });
});

describe('PlayerBar', () => {
  it('renders one bar per breakpoint, each hidden at the other', () => {
    render(<PlayerBar />);
    expect(phoneBar()).toHaveClass('md:hidden');
    expect(desktopBar()).toHaveClass('hidden', 'md:flex');
    // Phone first in the DOM, so nothing about the desktop bar's own order
    // changed underneath it.
    expect(phoneBar().compareDocumentPosition(desktopBar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The desktop bar must be pixel-for-pixel what it was before the phone bar
  // was split out of it: same footer, same grid, same three columns in the
  // same order, same control sizes. Only its display gate and the safe-area
  // class (0 on a desktop browser) are new.
  describe('the md layout is untouched', () => {
    it('keeps the footer and the grid it always had', () => {
      render(<PlayerBar />);
      expect(desktopBar().tagName).toBe('FOOTER');
      expect(desktopBar()).toHaveClass('shrink-0', 'bg-sidebar', 'border-t', 'border-sidebar-border', 'flex-col');
      const grid = desktopBar().firstElementChild!;
      expect(grid.className).toBe(
        'px-4 pt-3 pb-2 grid grid-cols-[1fr_auto_1fr] md:grid-cols-[1fr_2fr_1fr] gap-4 items-center',
      );
      expect(grid.children).toHaveLength(3);
    });

    it('keeps the three columns and their contents in order', () => {
      render(<PlayerBar />);
      const [left, middle, right] = [...desktopBar().firstElementChild!.children] as HTMLElement[];

      // Left: the now-playing cluster plus the per-track actions.
      expect(left).toHaveTextContent(TRACK.title);
      expect(left).toHaveTextContent(TRACK.artist);
      expect(within(left).getByRole('button', { name: 'Like' })).toBeInTheDocument();

      // Middle: the small transport over the inline, labelled seek bar.
      expect(within(middle).getByRole('button', { name: 'Pause' })).toHaveClass('h-10', 'w-10');
      expect(within(middle).getByRole('button', { name: 'Loop playlist' })).toHaveClass('hidden', 'md:inline-flex');
      // The inline seek bar: its own wrapper carries the md gate and the
      // elapsed / total labels the desktop bar has always shown.
      const seek = middle.children[1] as HTMLElement;
      expect(seek).toHaveClass('hidden', 'md:flex', 'w-full', 'max-w-xl');
      expect(seek).toHaveTextContent('1:32');
      expect(seek).toHaveTextContent('4:24');

      // Right: lyrics, tabs, queue, volume.
      expect(
        [...right.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
      ).toEqual(['Lyrics', 'Guitar tabs', 'Queue', 'Mute']);
      expect(within(right).getByRole('button', { name: 'Queue' })).toHaveClass('h-10', 'w-10', 'md:h-8', 'md:w-8');
    });

    it('has no phone-only leftovers inside it', () => {
      render(<PlayerBar />);
      // The grid and nothing else: the unlabelled phone progress strip that
      // used to sit under it moved into the phone bar.
      expect(desktopBar().children).toHaveLength(1);
      // The scrolling title belongs only to the phone bar.
      expect(desktopBar().querySelectorAll('[data-testid="marquee"]')).toHaveLength(0);
    });
  });

  it('gives both bars the shared safe-area class and no inline padding', () => {
    render(<PlayerBar />);
    for (const bar of [phoneBar(), desktopBar()]) {
      expect(bar).toHaveClass('safe-area-bottom');
      expect(bar.getAttribute('style')).toBeNull();
    }
  });

  it('hides the tabs button on both bars when the plugin is off', () => {
    useSettingsStore.setState({ tabsEnabled: false });
    render(<PlayerBar />);
    expect(screen.queryByRole('button', { name: 'Guitar tabs' })).toBeNull();
  });
});
