import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DizajnPage from './page';
import { SHELF_OPTIONS } from '@/components/library/options';
import { SPACING_SCALE } from '@/lib/spacing';
import { MOCK_LIKED_TRACKS } from './mock';
import { CHANGELOG_PLACEMENTS, CHANGELOG_STATES, BADGE_STYLES } from '@/components/library/options/changelog';
import { TRENDING_DATA, TRENDING_OPTIONS, TRENDING_VIEWS } from '@/components/library/options/trending';
import { MOCK_CHART } from './mock';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// @base-ui's Dialog reaches the repo root's hoisted React 18 through its own
// node_modules copy (see SearchOverlayContainer.test.tsx): render plain
// elements for the chrome so this test is about page wiring, not base-ui's
// portal/focus machinery.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('DizajnPage', () => {
  it('renders every section with no network', () => {
    render(<DizajnPage />);

    expect(screen.getByText('Trending shelf')).toBeInTheDocument();
    expect(screen.getByText("What's new (changelog)")).toBeInTheDocument();
    expect(screen.getByText('Instant search overlay')).toBeInTheDocument();
    expect(screen.getByText('Loading skeletons')).toBeInTheDocument();
    expect(screen.getByText('Spacing scale')).toBeInTheDocument();
    expect(screen.getByText('Collection page')).toBeInTheDocument();
    expect(screen.getByText('Library playlists, style options')).toBeInTheDocument();
  });

  it('renders each overlay state on demand from mock data', async () => {
    render(<DizajnPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Empty, with recents' }));
    expect(await screen.findByText('Midnight Drive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Searching' }));
    expect(await screen.findByText('Searching…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Results' }));
    expect(await screen.findByText('Second Wind')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    expect(
      await screen.findByText('No connection. This will run when you are back online.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rate limited' }));
    expect(await screen.findByText('Searching too fast, one moment.')).toBeInTheDocument();
  });

  it('renders the mock playlists, including the artwork-less and downloaded ones, for every option', () => {
    for (const option of SHELF_OPTIONS) {
      const { unmount } = render(<DizajnPage />);
      fireEvent.click(screen.getByRole('radio', { name: option.name }));

      expect(screen.getAllByText('Sunday Mornings').length).toBeGreaterThan(0); // no artwork
      expect(screen.getAllByText('Gym').length).toBeGreaterThan(0); // downloaded badge
      unmount();
    }
  });

  it('switches options with the picker and persists the choice to localStorage', async () => {
    render(<DizajnPage />);

    const denseList = SHELF_OPTIONS.find((o) => o.id === 'dense-list')!;
    fireEvent.click(screen.getByRole('radio', { name: denseList.name }));

    expect(screen.getAllByText(denseList.name).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(window.localStorage.getItem('dizajn-shelf-option')).toBe('dense-list'),
    );
  });

  it('restores the saved option on mount', () => {
    window.localStorage.setItem('dizajn-shelf-option', 'cover-led');
    render(<DizajnPage />);

    expect(screen.getByRole('radio', { name: 'Cover-led', checked: true })).toBeInTheDocument();
  });

  describe('Spacing scale section', () => {
    it('draws one ruler per token with its name, px value and width utility', () => {
      render(<DizajnPage />);
      const rulers = screen.getAllByTestId('spacing-ruler');
      expect(rulers).toHaveLength(SPACING_SCALE.length);
      SPACING_SCALE.forEach((step, i) => {
        expect(within(rulers[i]).getByText(step.name)).toBeInTheDocument();
        expect(within(rulers[i]).getByText(`${step.px}px`)).toBeInTheDocument();
        expect(rulers[i].querySelector(`.${step.ruler}`)).not.toBeNull();
      });
    });
  });

  describe('Collection page section', () => {
    it('renders the real CollectionPage from mock tracks, with no pickers', () => {
      render(<DizajnPage />);
      const section = screen.getByText('Collection page').closest('section')!;

      expect(within(section).getByRole('heading', { level: 1, name: 'Liked songs' })).toBeInTheDocument();
      expect(within(section).getByTestId('collection-header')).toBeInTheDocument();
      expect(within(section).getByTestId('action-bar')).toBeInTheDocument();
      for (const t of MOCK_LIKED_TRACKS) expect(within(section).getByText(t.title)).toBeInTheDocument();
      expect(within(section).queryByRole('radiogroup')).toBeNull();
      // The losing stage 1 candidates are gone from the page entirely.
      expect(screen.queryByRole('radio', { name: 'Grouped' })).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Below' })).toBeNull();
    });
  });

  describe("What's new (changelog) section", () => {
    const pick = (group: string, name: string) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));

    it('sits above the older sections', () => {
      render(<DizajnPage />);
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings.indexOf("What's new (changelog)")).toBeLessThan(headings.indexOf('Instant search overlay'));
    });

    it('renders all three pickers with every option as a radio, first one checked', () => {
      render(<DizajnPage />);
      for (const [group, options] of [
        ['Placement', CHANGELOG_PLACEMENTS],
        ['State', CHANGELOG_STATES],
        ['Badge', BADGE_STYLES],
      ] as const) {
        const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
        expect(radios.map((r) => r.textContent)).toEqual(options.map((o) => o.name));
        radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      }
      expect(screen.getAllByText('Sidebar link').length).toBeGreaterThan(0);
      expect(screen.getByRole('radio', { name: 'Top bar button' })).toBeInTheDocument();
    });

    it('renders the shell twice (desktop and phone) with the placement description under it', () => {
      render(<DizajnPage />);
      const section = screen.getByTestId('changelog-section');
      expect(within(section).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      expect(within(section).getByText('Phone (390px)')).toBeInTheDocument();
      expect(screen.getByTestId('changelog-description').textContent).toBe(CHANGELOG_PLACEMENTS[0].description);

      pick('Placement', 'Home banner');
      expect(screen.getByTestId('changelog-description').textContent).toBe(
        CHANGELOG_PLACEMENTS.find((p) => p.id === 'home-banner')!.description,
      );
    });

    it('renders each placement only where it belongs', () => {
      render(<DizajnPage />);
      const counts = () => ({
        link: screen.queryAllByTestId('whats-new-sidebar-link').length,
        card: screen.queryAllByTestId('whats-new-sidebar-card').length,
        banner: screen.queryAllByTestId('whats-new-home-banner').length,
        topBar: screen.queryAllByTestId('whats-new-top-bar-button').length,
        menuDot: within(within(screen.getByTestId('changelog-section')).getAllByTestId('mock-menu-button')[0]).queryAllByTestId('unread-dot').length,
      });

      // Sidebar link: in the desktop sidebar only (the phone drawer is shut).
      expect(counts()).toEqual({ link: 1, card: 0, banner: 0, topBar: 0, menuDot: 1 });

      pick('Placement', 'Sidebar card');
      expect(counts()).toEqual({ link: 0, card: 1, banner: 0, topBar: 0, menuDot: 1 });

      pick('Placement', 'Home banner');
      expect(counts()).toEqual({ link: 0, card: 0, banner: 2, topBar: 0, menuDot: 0 });

      // Top bar button: desktop corner and the phone top bar, whose empty
      // w-9 spacer it replaces.
      pick('Placement', 'Top bar button');
      expect(counts()).toEqual({ link: 0, card: 0, banner: 0, topBar: 2, menuDot: 0 });
    });

    it('puts the sidebar entry in the phone drawer when the menu opens', () => {
      render(<DizajnPage />);
      expect(screen.queryByTestId('mock-drawer')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu', pressed: false }));
      const drawer = screen.getByTestId('mock-drawer');
      expect(within(drawer).getByTestId('whats-new-sidebar-link')).toBeInTheDocument();
    });

    it('shows Mark all as read and the hide-tags switch in the Open state, for a page and for the popover', () => {
      render(<DizajnPage />);
      pick('State', 'Open');
      expect(screen.getAllByTestId('changelog-page')).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /Mark all as read/ }).length).toBe(2);
      expect(screen.getAllByRole('switch', { name: "Don't show New tags" }).length).toBe(2);

      pick('Placement', 'Top bar button');
      expect(screen.queryByTestId('changelog-page')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('changelog-panel')).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'Mark all as read' }).length).toBe(2);
      expect(screen.getAllByRole('switch', { name: "Don't show New tags" }).length).toBe(2);
    });

    it('Mark all as read and the switch both clear the New tags', () => {
      render(<DizajnPage />);
      pick('State', 'Open');
      expect(screen.getAllByTestId('new-badge').length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole('button', { name: /Mark all as read/ })[0]);
      expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);

      pick('State', 'Unread');
      expect(screen.getAllByTestId('new-badge').length).toBeGreaterThan(0);
      pick('State', 'Open');
      const toggle = screen.getAllByRole('switch', { name: "Don't show New tags" })[0];
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
      // "Always": going back to Unread keeps them hidden.
      pick('State', 'Unread');
      expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
      expect(screen.queryAllByTestId('unread-dot')).toHaveLength(0);
    });

    it('shows no New badge or unread dot in the Read state, for every placement', () => {
      render(<DizajnPage />);
      pick('State', 'Read');
      for (const p of CHANGELOG_PLACEMENTS) {
        pick('Placement', p.name);
        expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
        expect(screen.queryAllByTestId('unread-dot')).toHaveLength(0);
      }
      // Still reachable, just quiet.
      pick('Placement', 'Top bar button');
      expect(screen.getAllByTestId('whats-new-top-bar-button')).toHaveLength(2);
    });

    it('opens the changelog by clicking the entry point in the preview', () => {
      render(<DizajnPage />);
      fireEvent.click(screen.getByTestId('whats-new-sidebar-link'));
      expect(screen.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByTestId('changelog-page')).toHaveLength(2);
    });

    it('switches the badge style', () => {
      render(<DizajnPage />);
      expect(screen.getAllByTestId('new-badge').every((b) => b.dataset.variant === 'pulse')).toBe(true);
      pick('Badge', 'Dot');
      expect(screen.getAllByTestId('new-badge').every((b) => b.dataset.variant === 'dot')).toBe(true);
    });

    it('opens the desktop shell full screen and closes it with Escape or the close button', () => {
      render(<DizajnPage />);
      expect(screen.queryByTestId('changelog-fullscreen')).not.toBeInTheDocument();

      const section = screen.getByTestId('changelog-section');
      fireEvent.click(within(section).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen preview' });
      expect(within(overlay).getByTestId('shell-preview')).toHaveAttribute('data-phone', 'false');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('changelog-fullscreen')).not.toBeInTheDocument();

      fireEvent.click(within(section).getByRole('button', { name: 'View full screen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close full screen' }));
      expect(screen.queryByTestId('changelog-fullscreen')).not.toBeInTheDocument();
    });

    it('persists all three choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Placement', 'Top bar button');
      pick('State', 'Read');
      pick('Badge', 'Dot');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-changelog-placement')).toBe('top-bar'));
      expect(window.localStorage.getItem('dizajn-changelog-state')).toBe('read');
      expect(window.localStorage.getItem('dizajn-changelog-badge')).toBe('dot');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Top bar button' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Read' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Dot' })).toHaveAttribute('aria-checked', 'true');
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-changelog-placement', 'floating-toast');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Sidebar link' })).toHaveAttribute('aria-checked', 'true');
    });
  });
  describe('Trending shelf section', () => {
    const pick = (group: string, name: string) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));
    const section = () => screen.getByTestId('trending-section');
    const ranks = (root: HTMLElement) => within(root).getAllByTestId('chart-rank').map((r) => r.textContent);

    it('is the first section on the page', () => {
      render(<DizajnPage />);
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings[0]).toBe('Trending shelf');
      expect(headings.indexOf("What's new (changelog)")).toBeGreaterThan(0);
    });

    it('renders the three pickers with every option as a radio, first one checked', () => {
      render(<DizajnPage />);
      for (const [group, options] of [
        ['Shelf style', TRENDING_OPTIONS],
        ['View', TRENDING_VIEWS],
        ['Data', TRENDING_DATA],
      ] as const) {
        const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
        expect(radios.map((r) => r.textContent)).toEqual(options.map((o) => o.name));
        radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      }
      expect(TRENDING_OPTIONS.map((o) => o.name)).toEqual(['Ranked cards', 'Chart list', 'Hero + list']);
    });

    it('draws the mock Home in the shell, desktop and phone, with the shelf between the others', () => {
      render(<DizajnPage />);
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      const home = within(section()).getAllByTestId('mock-home')[0];
      const titles = within(home).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(titles).toEqual(['Recommended for you', 'Trending right now', 'Recently played']);
    });

    it('switching the style changes what renders, ranks always in chart order', () => {
      render(<DizajnPage />);
      const [desktop, phone] = within(section()).getAllByTestId('trending-shelf');
      expect(desktop.dataset.option).toBe('ranked-cards');
      expect(ranks(desktop)).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(ranks(phone)).toEqual(['1', '2']);
      expect(within(desktop).getByText(MOCK_CHART[0].track.title)).toBeInTheDocument();
      expect(within(desktop).getAllByTestId('movement')).toHaveLength(6);

      pick('Shelf style', 'Chart list');
      const list = within(section()).getAllByTestId('trending-shelf')[0];
      expect(list.dataset.option).toBe('chart-list');
      expect(ranks(list)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
      expect(within(list).getByRole('button', { name: `Play ${MOCK_CHART[9].track.title}` })).toBeInTheDocument();
      expect(within(list).queryByText(MOCK_CHART[10].track.title)).toBeNull();

      pick('Shelf style', 'Hero + list');
      const hero = within(section()).getAllByTestId('trending-shelf')[0];
      expect(hero.dataset.option).toBe('hero-list');
      expect(ranks(hero)).toEqual(['No. 1', '2', '3', '4', '5', '6']);
      expect(screen.getByTestId('trending-description').textContent).toBe(
        TRENDING_OPTIONS.find((o) => o.id === 'hero-list')!.description,
      );
    });

    it('shows the stale note only with stale data', () => {
      render(<DizajnPage />);
      expect(within(section()).queryAllByTestId('stale-note')).toHaveLength(0);
      pick('Data', 'Stale');
      expect(within(section()).getAllByTestId('stale-note').map((n) => n.textContent)).toEqual([
        'Updated 3 hours ago',
        'Updated 3 hours ago',
      ]);
    });

    it('Show all opens the full chart as a ranked collection page, and Back returns', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getAllByRole('button', { name: 'Show all (50)' })[0]);
      expect(screen.getByRole('radio', { name: 'Show all open' })).toHaveAttribute('aria-checked', 'true');
      const pages = within(section()).getAllByTestId('trending-show-all');
      expect(pages).toHaveLength(2);
      expect(within(pages[0]).getByRole('heading', { level: 1, name: 'Trending right now' })).toBeInTheDocument();
      expect(within(pages[0]).getByText(MOCK_CHART[49].track.title)).toBeInTheDocument();

      fireEvent.click(within(pages[0]).getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('radio', { name: 'Shelf' })).toHaveAttribute('aria-checked', 'true');
      expect(within(section()).queryByTestId('trending-show-all')).toBeNull();
    });

    it('opens the desktop shell full screen and closes it with Escape', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen trending preview' });
      expect(within(overlay).getByTestId('trending-shelf')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('trending-fullscreen')).not.toBeInTheDocument();
    });

    it('persists all three choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Shelf style', 'Chart list');
      pick('View', 'Show all open');
      pick('Data', 'Stale');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-trending-option')).toBe('chart-list'));
      expect(window.localStorage.getItem('dizajn-trending-view')).toBe('show-all');
      expect(window.localStorage.getItem('dizajn-trending-data')).toBe('stale');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Chart list' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Show all open' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Stale' })).toHaveAttribute('aria-checked', 'true');
      expect(section().dataset).toMatchObject({ option: 'chart-list', view: 'show-all', data: 'stale' });
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-trending-option', 'podium');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Ranked cards' })).toHaveAttribute('aria-checked', 'true');
    });
  });
});
