import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppShellLayout from './layout';

/** Owner's report: the desktop search pill's wrapper had no bottom
 *  padding, so a scrolled page's content ran straight up to its bottom
 *  edge (SearchDropdown.test.tsx covers that half of the fix). This test
 *  covers the other half: a fade at the top of `data-app-scroller`, so
 *  content sliding under the pill fades rather than being cut off. Every
 *  child component here is presentational chrome unrelated to the fade, so
 *  each is stubbed to keep this a layout-shape test, not an integration
 *  test of the whole shell. */
vi.mock('@/components/nav/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/nav/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/nav/MobileNav', () => ({ MobileNav: () => null }));
vi.mock('@/components/nav/Drawer', () => ({ Drawer: () => null }));
vi.mock('@/components/nav/BackToTop', () => ({ BackToTop: () => null }));
vi.mock('@/components/player/PlayerBar', () => ({ PlayerBar: () => null }));
vi.mock('@/components/player/NowPlaying', () => ({ NowPlaying: () => null }));
vi.mock('@/components/player/LyricsPanel', () => ({ LyricsPanel: () => null }));
vi.mock('@/components/search/SearchOverlayContainer', () => ({ SearchOverlayContainer: () => null }));
vi.mock('@/components/session/SessionHostBridge', () => ({ SessionHostBridge: () => null }));
vi.mock('@/lib/offline', () => ({ hydrateOfflineStore: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/stores/useUiStore', () => ({ useUiStore: (selector: (s: { setSearchOpen: () => void }) => unknown) => selector({ setSearchOpen: vi.fn() }) }));
vi.mock('@/hooks/useChangelog', () => ({ useChangelog: () => ({ hasNew: false }) }));

describe('AppShellLayout', () => {
  it('draws a pointer-events-none fade at the top of the scroller, desktop only, that never covers content once scrolled to the top', () => {
    render(<AppShellLayout>content</AppShellLayout>);
    const fade = screen.getByTestId('app-scroller-fade');

    // Never blocks a click on whatever it sits over.
    expect(fade.className).toContain('pointer-events-none');

    // bg-background: a theme-aware token, never a hardcoded colour value
    // (themes are coming, see app/globals.css).
    expect(fade.className).toContain('from-background');
    const rawColour = new RegExp(['#[0-9a-fA-F]{3,8}\\b', 'o' + 'klch\\(', 'rgb\\(', 'rgba\\('].join('|'));
    expect(fade.className).not.toMatch(rawColour);

    // sticky top-0, inside a zero-height wrapper: glued to the scroller's
    // own visible top edge without reserving any layout space of its own,
    // so at scrollTop 0 it sits over the page's own top padding rather
    // than over the first row of real content. Desktop only: hidden by
    // default, shown from md: up.
    const wrapper = fade.parentElement!;
    expect(wrapper.className).toContain('sticky');
    expect(wrapper.className).toContain('top-0');
    expect(wrapper.className).toContain('h-0');
    expect(wrapper.className).toContain('hidden');
    expect(wrapper.className).toContain('md:block');

    // Lives inside the actual scroller.
    const scroller = screen.getByText('content').closest('[data-app-scroller]');
    expect(scroller).toContainElement(wrapper);
  });
});
