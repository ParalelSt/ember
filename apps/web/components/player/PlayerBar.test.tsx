import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PlayerBar } from './PlayerBar';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
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
// The window size decides which bar renders. A real media query, so the page
// only ever holds one transport (see hooks/useIsDesktop).
const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));
// The add menu draws its trigger's class and, for the "More" variant, the
// items the bar hands it; the menu primitives render inline (no portal).
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ more, triggerClassName }: { more?: ReactNode; triggerClassName?: string }) => (
    <div data-testid={more ? 'more-menu' : 'add-menu'} className={triggerClassName}>{more}</div>
  ),
}));
const shareTrack = vi.hoisted(() => vi.fn());
vi.mock('@/components/track/ShareButton', () => ({
  ShareButton: ({ className }: { className?: string }) => <button type="button" aria-label="Share" className={className} />,
  shareTrack,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, onClick, className }: PropsWithChildren<{ onClick?: () => void; className?: string }>) => (
    <div role="menuitem" onClick={onClick} className={className}>{children}</div>
  ),
  DropdownMenuSeparator: ({ className }: { className?: string }) => <hr className={className} />,
}));
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

const bar = () => screen.getByTestId('player-bar');
/** Render the desktop bar and hand it back. `desktop` already defaults to
 *  true in beforeEach, so this is just render-and-find. */
const desktopBar = () => {
  render(<PlayerBar />);
  return bar();
};

beforeEach(() => {
  desktop.value = true;
  useSettingsStore.setState({ tabsEnabled: true, partyVolume: false });
});

describe('PlayerBar', () => {
  it('renders exactly one bar, the one the window calls for', () => {
    desktop.value = false;
    const { unmount } = render(<PlayerBar />);
    expect(screen.getAllByTestId('player-bar')).toHaveLength(1);
    expect(screen.getByTestId('phone-player-bar')).toBeInTheDocument();
    // One footer, one transport: suites that reach for `footer` still find
    // a single bar, and no control is in the page twice.
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
    unmount();

    desktop.value = true;
    render(<PlayerBar />);
    expect(screen.getAllByTestId('player-bar')).toHaveLength(1);
    expect(screen.queryByTestId('phone-player-bar')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
  });

  // The desktop bar keeps the footer, the three columns in the same order and
  // the control sizes it had before the phone bar was split out of it. The
  // grid's columns changed for bughunt V1 (the title's floor, below).
  describe('the md layout', () => {
    it('keeps the footer and the grid it always had', () => {
      const footer = desktopBar();
      expect(footer.tagName).toBe('FOOTER');
      expect(footer).toHaveClass('shrink-0', 'bg-sidebar', 'border-t', 'border-sidebar-border', 'flex', 'flex-col');
      const grid = footer.firstElementChild!;
      expect(grid.className).toBe(
        'px-4 pt-3 pb-2 grid grid-cols-[1fr_auto_1fr] md:grid-cols-[minmax(13.5rem,1fr)_1fr_auto] lg:grid-cols-[minmax(16.5rem,1fr)_2fr_1fr] xl:grid-cols-[minmax(20rem,1fr)_2fr_1fr] gap-4 items-center',
      );
      expect(grid.children).toHaveLength(3);
    });

    it('keeps the three columns and their contents in order', () => {
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
      // The grid, and the queue sheet the mock renders as nothing: the
      // unlabelled phone progress strip that used to sit under the grid
      // moved into the phone bar.
      const footer = desktopBar();
      expect(footer.children).toHaveLength(1);
      // The scrolling title belongs only to the phone bar.
      expect(footer.querySelectorAll('[data-testid="marquee"]')).toHaveLength(0);
    });
  });

  // Bughunt V1: on a narrow desktop window the title had no room left.
  describe('below xl, the title keeps its room', () => {
    it('keeps add and share beside the title from xl up only', () => {
      const [left] = [...desktopBar().firstElementChild!.children] as HTMLElement[];
      expect(within(left).getByTestId('add-menu')).toHaveClass('max-xl:hidden');
      expect(within(left).getByRole('button', { name: 'Share' })).toHaveClass('max-xl:hidden');
      expect(within(left).getByTestId('more-menu')).toHaveClass('xl:hidden');
    });

    it('puts share, and below lg lyrics and tabs, in the More menu', () => {
      const more = within(desktopBar()).getByTestId('more-menu');
      const items = within(more).getAllByRole('menuitem');
      expect(items.map((i) => i.textContent?.trim())).toEqual(['Share', 'Lyrics', 'Guitar tabs']);
      expect(items[0]).not.toHaveClass('lg:hidden');
      expect(items[1]).toHaveClass('lg:hidden');
      expect(items[2]).toHaveClass('lg:hidden');

      fireEvent.click(items[0]);
      expect(shareTrack).toHaveBeenCalledWith(TRACK);
      useUiStore.getState().setLyricsOpen(false);
      fireEvent.click(items[1]);
      expect(useUiStore.getState().lyricsOpen).toBe(true);
      useUiStore.getState().setLyricsOpen(false);
    });

    it('leaves only queue and mute on the right below lg', () => {
      const [, , right] = [...desktopBar().firstElementChild!.children] as HTMLElement[];
      expect(within(right).getByRole('button', { name: 'Lyrics' })).toHaveClass('hidden', 'lg:inline-flex');
      expect(within(right).getByRole('button', { name: 'Guitar tabs' })).toHaveClass('hidden', 'lg:inline-flex');
      // The volume slider's box: gone below lg, shorter below xl.
      const slider = right.querySelector('input[type="range"]')!.parentElement!;
      expect(slider).toHaveClass('hidden', 'lg:block', 'w-20', 'xl:w-29.5');
    });

    it('leaves the tabs item out of the More menu when the plugin is off', () => {
      useSettingsStore.setState({ tabsEnabled: false });
      const more = within(desktopBar()).getByTestId('more-menu');
      expect(within(more).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Share', 'Lyrics']);
    });
  });

  it('stands the desktop bar off the bottom edge itself, with no inline padding', () => {
    // MobileNav is mounted but `md:hidden` at this width, so it lifts
    // nothing here: the desktop footer is the bottom-most visible element
    // and carries the safe-area class itself.
    desktop.value = true;
    const { unmount } = render(<PlayerBar />);
    expect(bar()).toHaveClass('safe-area-bottom');
    expect(bar().getAttribute('style')).toBeNull();
    unmount();
  });

  it('leaves the safe-area lift to MobileNav on a phone, not the phone bar', () => {
    // MobileNav renders below the phone bar in the real shell (app/(app)/layout.tsx)
    // and is the bottom-most element there, so it alone carries the inset.
    desktop.value = false;
    const { unmount } = render(<PlayerBar />);
    expect(bar()).not.toHaveClass('safe-area-bottom');
    expect(bar().getAttribute('style')).toBeNull();
    unmount();
  });

  it('hides the tabs button when the plugin is off', () => {
    useSettingsStore.setState({ tabsEnabled: false });
    render(<PlayerBar />);
    expect(screen.queryByRole('button', { name: 'Guitar tabs' })).toBeNull();
  });

  describe('on a phone', () => {
    beforeEach(() => {
      desktop.value = false;
      usePlayerStore.getState().setNowPlayingOpen(false);
    });

    it('draws the one-row bar with play and next as its controls', () => {
      render(<PlayerBar />);
      const footer = bar();
      expect(within(footer).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open player', 'Pause', 'Next']);
      // MobileNav under it carries the inset instead: see the dedicated
      // 'leaves the safe-area lift to MobileNav' test above.
      expect(footer).not.toHaveClass('safe-area-bottom');
    });

    it('opens the full-screen view on a tap, but not from play or next', () => {
      render(<PlayerBar />);
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
      fireEvent.click(screen.getByTestId('phone-player-row'));
      expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
    });
  });
});
