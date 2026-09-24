import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
vi.mock('@/components/player/LyricsPanel', () => ({ LyricsPanel: () => <aside data-testid="lyrics" /> }));
vi.mock('@/components/search/SearchOverlayContainer', () => ({
  SearchOverlayContainer: () => <div role="search" data-testid="search-box" />,
}));
vi.mock('@/lib/offline', () => ({ hydrateOfflineStore: vi.fn(async () => {}) }));
vi.mock('@/hooks/useChangelog', () => ({ useChangelog: () => ({ hasNew: false }) }));
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
    // column's top.
    const column = scroller().parentElement!;
    expect([...column.children]).toEqual([scroller()]);
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

describe('LyricsPanel under the bar', () => {
  it('sticks just under the bar and is that much shorter than the scroller', async () => {
    const { LyricsPanel: Real } = await vi.importActual<{ LyricsPanel: typeof LyricsPanel }>(
      '@/components/player/LyricsPanel',
    );
    useUiStore.setState({ lyricsOpen: true });
    render(<Real />);
    const aside = document.querySelector<HTMLElement>('aside[aria-label="Lyrics"]')!;
    expect(aside.className).toMatch(/\bsticky\b/);
    expect(aside.className).toMatch(/\bz-30\b/);
    expect(aside.style.top).toBe('var(--ember-topbar-h, 0px)');
    expect(aside.style.height).toBe('calc(var(--ember-scroller-h, 100dvh) - var(--ember-topbar-h, 0px))');
    useUiStore.setState({ lyricsOpen: false });
  });
});
