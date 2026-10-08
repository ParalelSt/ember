import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import AppShellLayout from './layout';
import { LyricsPanel } from '@/components/player/LyricsPanel';
import { useUiStore } from '@/stores/useUiStore';

/* The shell's own pieces stand in as plain markers: this test is about
 * where the desktop top bar sits, not about what each piece draws. */
vi.mock('@/components/nav/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
vi.mock('@/components/nav/TopBar', () => ({ TopBar: () => <header data-testid="phone-topbar" /> }));
vi.mock('@/components/nav/MobileNav', () => ({ MobileNav: () => <nav data-testid="mobile-nav" /> }));
vi.mock('@/components/nav/Drawer', () => ({ Drawer: () => null }));
vi.mock('@/components/nav/BackToTop', () => ({ BackToTop: () => <button type="button">Back to top</button> }));
vi.mock('@/components/player/PlayerBar', () => ({ PlayerBar: () => <footer data-testid="player-bar" /> }));
vi.mock('@/components/player/NowPlaying', () => ({ NowPlaying: () => null }));
vi.mock('@/components/player/LyricsBody', () => ({ LyricsBody: () => <div>lyrics</div> }));
vi.mock('@/components/player/LyricsPanel', () => ({
  LYRICS_PANEL_W: 'min(28rem, 40vw)',
  LyricsPanel: () => <aside data-testid="lyrics" />,
}));
vi.mock('@/components/search/SearchOverlayContainer', () => ({
  SearchOverlayContainer: () => <div role="search" data-testid="search-box" />,
}));
vi.mock('@/lib/offline', () => ({ hydrateOfflineStore: vi.fn(async () => {}) }));
vi.mock('@/hooks/useChangelog', () => ({ useChangelog: () => ({ hasNew: false }) }));
vi.mock('@/hooks/useSession', () => ({ useReleaseStaleHosting: () => {} }));
vi.mock('@/components/session/SessionHostBridge', () => ({ SessionHostBridge: () => null }));
vi.mock('@/components/import/TransferStatus', () => ({ TransferStatus: () => null }));
vi.mock('@/components/auth/QrScanHost', () => ({ QrScanHost: () => null }));
const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

const BAR_H = 80;
let heightSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  desktop.value = true;
  useUiStore.setState({ searchOpen: false });
  heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'topbar-bar' ? BAR_H : 0;
  });
});
afterEach(() => heightSpy.mockRestore());

function renderShell() {
  return render(
    <AppShellLayout>
      <h1>Home</h1>
    </AppShellLayout>,
  );
}

const scroller = () => document.querySelector<HTMLElement>('[data-app-scroller]')!;

describe('app shell, desktop top bar', () => {
  it('puts the search bar sticky INSIDE the scroller, so the scrollbar runs the full column', () => {
    renderShell();
    const bar = screen.getByTestId('topbar-bar');
    expect(scroller().contains(bar)).toBe(true);
    // First thing in the scroller: nothing above it pushes it down.
    expect(scroller().firstElementChild).toBe(bar);
    expect(bar.contains(screen.getByTestId('search-box'))).toBe(true);
    // The scroller is the column's only in-flow child: it starts at the
    // column's top. (Back to top floats over it, out of flow.)
    const column = scroller().parentElement!;
    const backToTop = screen.getByRole('button', { name: 'Back to top' });
    expect([...column.children].filter((c) => c !== backToTop)).toEqual([scroller()]);
  });

  // Bughunt V12: Back to top floats against the scroller's own column, so
  // it keeps one step above the scroller's edge with or without the player
  // bar, and every page ends with room for it.
  it('pins Back to top to the scroller column and leaves room for it under the page', () => {
    renderShell();
    const column = scroller().parentElement!;
    expect(column).toHaveClass('relative');
    expect(column.contains(screen.getByRole('button', { name: 'Back to top' }))).toBe(true);
    const page = screen.getByRole('heading', { name: 'Home' }).parentElement!;
    expect(page).toHaveClass('pb-section');
  });

  it('adds no extra layout gap: the page row fills only what is left under the bar', () => {
    renderShell();
    const row = scroller().children[1] as HTMLElement;
    expect(row.contains(screen.getByRole('heading', { name: 'Home' }))).toBe(true);
    expect(row.className).toContain('min-h-[calc(100%-var(--ember-topbar-h,0px))]');
    // The page keeps its own top padding (the heading sits where it did).
    const main = row.querySelector('main')!;
    expect(main.className).toMatch(/\bmd:p-page-lg\b/);
    expect(main.className).not.toMatch(/\bmd:pt-/);
  });

  it('publishes the bar height as --ember-topbar-h on the content column', () => {
    renderShell();
    const column = scroller().parentElement!;
    expect(column.style.getPropertyValue('--ember-topbar-h')).toBe(`${BAR_H}px`);
  });

  it('publishes the lyrics panel width while it is open, so the bar cover stops short of it', () => {
    renderShell();
    const column = () => scroller().parentElement!;
    expect(column().style.getPropertyValue('--ember-lyrics-w')).toBe('0px');
    act(() => useUiStore.setState({ lyricsOpen: true }));
    expect(column().style.getPropertyValue('--ember-lyrics-w')).toBe('min(28rem, 40vw)');
    act(() => useUiStore.setState({ lyricsOpen: false }));
  });

  it('lifts the bar over the lyrics panel while the search panel is open', () => {
    useUiStore.setState({ searchOpen: true });
    renderShell();
    expect(screen.getByTestId('topbar-bar').className).toMatch(/\bz-40\b/);
  });
});

describe('app shell, phone', () => {
  it('is unchanged: no top bar in the scroller, the search sheet outside it, --ember-topbar-h 0', () => {
    desktop.value = false;
    renderShell();
    expect(screen.queryByTestId('topbar-bar')).toBeNull();
    const search = screen.getByTestId('search-box');
    expect(scroller().contains(search)).toBe(false);
    const column = scroller().parentElement!;
    expect(column.firstElementChild).toBe(search);
    expect(column.style.getPropertyValue('--ember-topbar-h')).toBe('0px');
    expect(screen.getByTestId('phone-topbar')).toBeInTheDocument();
  });
});

describe('LyricsPanel beside the bar', () => {
  it('runs from the top of the scroller to its bottom: pulled up by the bar, sticky at the top', async () => {
    const { LyricsPanel: Real, LYRICS_PANEL_W: width } = await vi.importActual<{
      LyricsPanel: typeof LyricsPanel;
      LYRICS_PANEL_W: string;
    }>(
      '@/components/player/LyricsPanel',
    );
    useUiStore.setState({ lyricsOpen: true });
    render(<Real />);
    const aside = document.querySelector<HTMLElement>('aside[aria-label="Lyrics"]')!;
    expect(aside.className).toMatch(/\bsticky\b/);
    expect(aside.className).toMatch(/\bself-start\b/);
    expect(aside.className).toMatch(/\bz-30\b/);
    // Phones never show it (they scroll to the lyrics in Now playing).
    expect(aside.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(aside.className).toMatch(/\bmd:flex\b/);
    // The width the layout hands the bar (happy-dom drops a min() width
    // from the style, so the constant is checked instead).
    expect(width).toBe('min(28rem, 40vw)');
    // Not under the bar any more: it starts where the scroller starts and
    // is as tall as the scroller.
    expect(aside.style.top).toBe('0px');
    expect(aside.style.marginTop).toBe('calc(-1 * var(--ember-topbar-h, 0px))');
    expect(aside.style.height).toBe('var(--ember-scroller-h, 100dvh)');
    useUiStore.setState({ lyricsOpen: false });
  });

  it('the bar stops short of the panel, so the panel has the strip above the page to itself', () => {
    renderShell();
    const bar = screen.getByTestId('topbar-bar');
    expect(bar.style.marginRight).toBe('var(--ember-lyrics-w, 0px)');
    // The panel is the row's last child, after <main>, in the scroller.
    const row = scroller().children[1] as HTMLElement;
    expect(row.lastElementChild).toBe(screen.getByTestId('lyrics'));
  });
});
