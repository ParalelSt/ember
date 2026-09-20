import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DizajnPage from './page';
import { SHELF_OPTIONS } from '@/components/library/options';
import { SPACING_SCALE } from '@/lib/spacing';
import { MOCK_LIKED_TRACKS } from './mock';
import { CHANGELOG_PLACEMENTS, CHANGELOG_STATES, BADGE_STYLES } from '@/components/library/options/changelog';
import {
  IMPORT_CHOICE_STYLES,
  IMPORT_REVIEW_STYLES,
  IMPORT_SOURCES,
  IMPORT_STEPS,
} from '@/components/library/options/imports';
import { MOCK_IMPORT_ITEMS } from './mock';
import { TRENDING_DATA, TRENDING_OPTIONS, TRENDING_VIEWS } from '@/components/library/options/trending';
import { MOCK_CHART } from './mock';
import {
  RECOMMENDED_ROW,
  ROW_CONTROLS,
  ROW_INDICATORS,
  ROW_STATES,
} from '@/components/library/options/searchrows';
import { MOCK_SEARCH_RECENTS, MOCK_SEARCH_RESULTS } from './mock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** The page's own section titles, in order. The previews inside a section
 *  render <h2>s of their own (a mock shelf header, the search overlay's
 *  "Recent searches"), so ordering has to look at a section's own heading
 *  rather than every level-2 heading on the page. */
function sectionHeadings(): (string | null)[] {
  return screen
    .getAllByRole('heading', { level: 2 })
    .filter((h) => h.parentElement?.tagName === 'SECTION')
    .map((h) => h.textContent);
}

describe('DizajnPage', () => {
  it('renders every section with no network', () => {
    render(<DizajnPage />);

    expect(screen.getByText('Search rows')).toBeInTheDocument();
    expect(screen.getByText('Playlist import')).toBeInTheDocument();
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

  describe('Playlist import section', () => {
    const section = () => screen.getByTestId('imports-section');
    const pick = (group: string, name: string) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));

    it('sits right below Search rows, ahead of every other section', () => {
      render(<DizajnPage />);
      expect(sectionHeadings().slice(0, 2)).toEqual(['Search rows', 'Playlist import']);
    });

    it('has a realistic mock: 42 songs, 36 confident, 4 to review with 3 to 5 candidates, 2 not found', () => {
      expect(MOCK_IMPORT_ITEMS).toHaveLength(42);
      const by = (s: string) => MOCK_IMPORT_ITEMS.filter((i) => i.status === s);
      expect(by('matched')).toHaveLength(36);
      expect(by('review')).toHaveLength(4);
      expect(by('not-found')).toHaveLength(2);
      for (const i of by('review')) {
        expect(i.candidates!.length).toBeGreaterThanOrEqual(3);
        expect(i.candidates!.length).toBeLessThanOrEqual(5);
        for (const c of i.candidates!) expect(c.reasons.length).toBeGreaterThan(0);
      }
    });

    it('renders all four pickers as radiogroups with the first option checked', () => {
      render(<DizajnPage />);
      for (const [group, options] of [
        ['Choice style', IMPORT_CHOICE_STYLES],
        ['Step', IMPORT_STEPS],
        ['Review screen', IMPORT_REVIEW_STYLES],
        ['Pasted link', IMPORT_SOURCES],
      ] as const) {
        const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
        expect(radios.map((r) => r.textContent)).toEqual(options.map((o) => o.name));
        radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      }
      pick('Choice style', 'Cards');
      expect(within(screen.getByRole('radiogroup', { name: 'Choice style' })).getByRole('radio', { name: 'Cards' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('renders the shell twice, desktop and phone, with the dialog open over it', () => {
      render(<DizajnPage />);
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      expect(within(section()).getByText('Phone (390px)')).toBeInTheDocument();
      expect(within(section()).getAllByTestId('import-dialog')).toHaveLength(2);
    });

    it('shows tabs only for Tabs, cards only for Cards, the hint only for Smart field', () => {
      render(<DizajnPage />);
      const s = section();
      expect(within(s).getAllByRole('tab', { name: 'Import from a link' })).toHaveLength(2);
      expect(within(s).queryAllByTestId('import-choice-card')).toHaveLength(0);

      pick('Choice style', 'Cards');
      expect(within(s).queryAllByRole('tab')).toHaveLength(0);
      expect(within(s).getAllByTestId('import-choice-card')).toHaveLength(4);

      pick('Choice style', 'Smart field');
      expect(within(s).queryAllByRole('tab')).toHaveLength(0);
      expect(within(s).queryAllByTestId('import-choice-card')).toHaveLength(0);
      expect(within(s).getAllByTestId('smart-field-hint')).toHaveLength(2);
    });

    it('Tabs: the Import tab switches the dialog body to the link field', () => {
      render(<DizajnPage />);
      const tab = within(section()).getAllByRole('tab', { name: 'Import from a link' })[0];
      expect(tab).toHaveAttribute('aria-selected', 'false');
      fireEvent.click(tab);
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(within(section()).getByRole('textbox', { name: 'Playlist link' })).toBeInTheDocument();
    });

    it('Cards: picking Import slides to the link step, Back returns', () => {
      render(<DizajnPage />);
      pick('Choice style', 'Cards');
      fireEvent.click(within(section()).getAllByTestId('import-choice-card')[1]);
      expect(within(section()).getByRole('dialog', { name: 'Import from a link' })).toBeInTheDocument();
      fireEvent.click(within(section()).getByRole('button', { name: 'Back' }));
      expect(within(section()).getAllByTestId('import-choice-card')).toHaveLength(4);
    });

    it('Link pasted shows the preview for every style, with the source badge and song count', () => {
      render(<DizajnPage />);
      pick('Step', 'Link pasted');
      for (const style of IMPORT_CHOICE_STYLES) {
        pick('Choice style', style.name);
        const previews = within(section()).getAllByTestId('link-preview');
        expect(previews).toHaveLength(2);
        expect(within(previews[0]).getByText('Late night drive')).toBeInTheDocument();
        expect(within(previews[0]).getByText(/42 songs/)).toBeInTheDocument();
        expect(within(previews[0]).getByTestId('source-badge')).toHaveTextContent('Spotify');
        expect(within(section()).queryByTestId('first-100-note')).toBeNull();
      }
      pick('Pasted link', 'YouTube Music');
      expect(within(within(section()).getAllByTestId('link-preview')[0]).getByTestId('source-badge')).toHaveTextContent(
        'YouTube Music',
      );
      pick('Pasted link', 'Spotify, over 100');
      expect(within(section()).getAllByTestId('first-100-note')).toHaveLength(2);
    });

    it('Create moves to Importing: dialog gone, ring and count in the sidebar, rows landing, banner', () => {
      render(<DizajnPage />);
      pick('Step', 'Link pasted');
      expect(within(section()).queryAllByTestId('import-progress-ring')).toHaveLength(0);
      fireEvent.click(within(section()).getAllByRole('button', { name: /Create, import 42 songs/ })[0]);

      expect(screen.getByRole('radio', { name: 'Importing' })).toHaveAttribute('aria-checked', 'true');
      expect(within(section()).queryByTestId('import-dialog')).toBeNull();
      const navRow = within(section()).getByTestId('import-nav-row');
      expect(navRow).toHaveTextContent('18 of 42');
      expect(within(navRow).getByTestId('import-progress-ring')).toBeInTheDocument();
      expect(within(section()).getAllByTestId('import-progress-banner')).toHaveLength(2);
      // 24 of 42 still to land, in each frame.
      expect(within(section()).getAllByTestId('pending-row')).toHaveLength(48);
    });

    it('the progress ring shows only while importing', () => {
      render(<DizajnPage />);
      for (const step of IMPORT_STEPS) {
        pick('Step', step.name);
        const rings = within(section()).queryAllByTestId('import-progress-ring').length;
        if (step.id === 'importing') expect(rings).toBeGreaterThan(0);
        else expect(rings).toBe(0);
      }
    });

    it('Done shows the summary, and Review opens the picked review screen', () => {
      render(<DizajnPage />);
      pick('Step', 'Done');
      const summary = within(section()).getAllByTestId('import-summary')[0];
      expect(summary).toHaveTextContent('36 added');
      expect(summary).toHaveTextContent('4 need review');
      expect(summary).toHaveTextContent('2 not found');
      expect(within(section()).queryByTestId('candidates-popover')).toBeNull();

      fireEvent.click(within(summary).getByRole('button', { name: 'Review' }));
      expect(section()).toHaveAttribute('data-review-open', 'true');
      expect(within(section()).getAllByTestId('candidates-popover')).toHaveLength(2);
    });

    it('each review option renders its own screen, and only Inline has the popover', () => {
      render(<DizajnPage />);
      pick('Review screen', 'Inline');
      // Picking a review screen jumps to Done with it open.
      expect(screen.getByRole('radio', { name: 'Done' })).toHaveAttribute('aria-checked', 'true');
      expect(within(section()).getAllByTestId('candidates-popover')).toHaveLength(2);
      expect(within(section()).queryByTestId('review-sheet')).toBeNull();
      expect(within(section()).queryByTestId('review-page')).toBeNull();

      pick('Review screen', 'Side sheet');
      expect(within(section()).queryByTestId('candidates-popover')).toBeNull();
      expect(within(section()).getAllByTestId('review-sheet')).toHaveLength(2);

      pick('Review screen', 'Review page');
      expect(within(section()).queryByTestId('candidates-popover')).toBeNull();
      expect(within(section()).queryByTestId('review-sheet')).toBeNull();
      expect(within(section()).getAllByTestId('review-page')).toHaveLength(2);
    });

    it('candidate rows have a preview button and plain-words reasons', () => {
      render(<DizajnPage />);
      pick('Review screen', 'Inline');
      const pop = within(section()).getAllByTestId('candidates-popover')[0];
      const rows = within(pop).getAllByTestId('candidate-row');
      expect(rows).toHaveLength(3); // Instant Crush
      expect(within(rows[0]).getByRole('button', { name: /^Preview "/ })).toBeInTheDocument();
      expect(within(rows[0]).getByText('Length matches')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Live version')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Different artist')).toBeInTheDocument();
    });

    it('Inline: picking a candidate resolves the row and opens the next one', () => {
      render(<DizajnPage />);
      pick('Review screen', 'Inline');
      const firstPop = within(section()).getAllByTestId('candidates-popover')[0];
      expect(firstPop).toHaveAccessibleName('Pick a match for Instant Crush');
      fireEvent.click(within(within(firstPop).getAllByTestId('candidate-row')[0]).getByRole('button', { pressed: false }));
      expect(within(section()).getAllByTestId('candidates-popover')[0]).toHaveAccessibleName('Pick a match for Dreams');
      expect(within(section()).getAllByTestId('import-summary')[0]).toHaveTextContent('3 need review');
    });

    it('Side sheet: number keys pick, S skips, then All reviewed', () => {
      render(<DizajnPage />);
      pick('Review screen', 'Side sheet');
      const sheet = () => within(section()).getAllByTestId('review-sheet')[0];
      expect(sheet()).toHaveTextContent('1 of 4');
      expect(within(sheet()).getAllByTestId('candidate-row')).toHaveLength(3);
      fireEvent.keyDown(window, { key: '2' });
      expect(sheet()).toHaveTextContent('2 of 4');
      fireEvent.keyDown(window, { key: 's' });
      expect(sheet()).toHaveTextContent('3 of 4');
      // Take On Me has five candidates: three up front, two behind "Show 2 more".
      fireEvent.click(within(sheet()).getByRole('button', { name: 'Show 2 more' }));
      expect(within(sheet()).getAllByTestId('candidate-row')).toHaveLength(5);
      fireEvent.click(within(sheet()).getByRole('button', { name: 'Skip S' }));
      fireEvent.keyDown(window, { key: '1' });
      expect(sheet()).toHaveTextContent('All reviewed');
    });

    it('Review page: best match chosen by default, Accept all resolves everything', () => {
      render(<DizajnPage />);
      pick('Review screen', 'Review page');
      const page = within(section()).getAllByTestId('review-page')[0];
      const cards = within(page).getAllByTestId('review-card');
      expect(cards).toHaveLength(4);
      for (const card of cards) {
        const rows = within(card).getAllByTestId('candidate-row');
        expect(rows[0]).toHaveAttribute('data-selected', 'true');
        rows.slice(1).forEach((r) => expect(r).toHaveAttribute('data-selected', 'false'));
      }
      expect(within(page).getAllByTestId('review-not-found')).toHaveLength(2);

      fireEvent.click(within(page).getByRole('button', { name: 'Accept all (4)' }));
      expect(within(page).queryAllByTestId('review-card')).toHaveLength(0);
      expect(within(page).getAllByTestId('review-card-done')).toHaveLength(4);
    });

    it('opens the desktop shell full screen', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByTestId('imports-fullscreen');
      expect(within(overlay).getByTestId('shell-preview')).toHaveAttribute('data-phone', 'false');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('imports-fullscreen')).toBeNull();
    });

    it('persists the three choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Choice style', 'Smart field');
      pick('Review screen', 'Side sheet');
      pick('Step', 'Importing');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-imports-style')).toBe('smart-field'));
      expect(window.localStorage.getItem('dizajn-imports-step')).toBe('importing');
      expect(window.localStorage.getItem('dizajn-imports-review')).toBe('sheet');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Smart field' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Importing' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Side sheet' })).toHaveAttribute('aria-checked', 'true');
      expect(section()).toHaveAttribute('data-step', 'importing');
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-imports-style', 'wizard');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Tabs' })).toHaveAttribute('aria-checked', 'true');
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
        // Scoped: the import section's shell has a menu button of its own.
        menuDot: within(within(screen.getByTestId('changelog-section')).getAllByTestId('mock-menu-button')[0]).queryAllByTestId(
          'unread-dot',
        ).length,
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
      const section = screen.getByTestId('changelog-section');
      expect(within(section).queryByTestId('mock-drawer')).not.toBeInTheDocument();
      fireEvent.click(within(section).getByRole('button', { name: 'Open menu', pressed: false }));
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
      // Scoped: the import section has its own "View full screen".
      const section = screen.getByTestId('changelog-section');
      expect(screen.queryByTestId('changelog-fullscreen')).not.toBeInTheDocument();

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

    it('is the third section on the page, right after Playlist import', () => {
      render(<DizajnPage />);
      const headings = sectionHeadings();
      expect(headings[2]).toBe('Trending shelf');
      expect(headings.indexOf("What's new (changelog)")).toBeGreaterThan(2);
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

  describe('Search rows section', () => {
    const pick = (group: string, name: string) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));
    const section = () => screen.getByTestId('searchrows-section');
    // Both frames draw the same overlay; the desktop one is the first.
    const desktop = () => within(within(section()).getAllByTestId('searchrows-overlay')[0]);
    const activeRow = () => desktop().getAllByTestId('search-row').find((r) => r.dataset.active === 'true')!;
    const ROW_COUNT = MOCK_SEARCH_RECENTS.length + MOCK_SEARCH_RESULTS.length;

    it('is the first section on the page, in the desktop and phone shells', () => {
      render(<DizajnPage />);
      expect(sectionHeadings()[0]).toBe('Search rows');
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
    });

    it('renders the three pickers with every option as a radio, first one checked', () => {
      render(<DizajnPage />);
      for (const [group, options] of [
        ['Control style', ROW_CONTROLS],
        ['Playing indicator', ROW_INDICATORS],
        ['Player state', ROW_STATES],
      ] as const) {
        const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
        expect(radios.map((r) => r.textContent)).toEqual(options.map((o) => o.name));
        radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      }
      expect(ROW_CONTROLS.map((o) => o.name)).toEqual(['On the art', 'Trailing button', 'Leading slot']);
      expect(ROW_INDICATORS.map((o) => o.name)).toEqual(['Bars', 'Ember title', 'Tinted row']);
      expect(ROW_STATES.map((o) => o.name)).toEqual(['Nothing playing', 'This row playing', 'This row paused']);
    });

    it('draws the overlay over the shell with the mock recents above the results', () => {
      render(<DizajnPage />);
      expect(within(section()).getAllByTestId('searchrows-overlay')).toHaveLength(2);
      expect(desktop().getByText('Recent searches')).toBeInTheDocument();
      const rows = desktop().getAllByTestId('search-row');
      expect(rows).toHaveLength(ROW_COUNT);
      expect(rows.map((r) => within(r).getAllByText(/./)[0]?.textContent).slice(0, 3)).toEqual(
        MOCK_SEARCH_RECENTS.map((t) => t.title),
      );
      for (const t of MOCK_SEARCH_RESULTS) expect(desktop().getByText(t.title)).toBeInTheDocument();
    });

    it('each control style renders its own control on every row and no other', () => {
      render(<DizajnPage />);
      const counts = () => ({
        art: desktop().queryAllByTestId('row-art-control').length,
        trailing: desktop().queryAllByTestId('row-trailing-control').length,
        lead: desktop().queryAllByTestId('row-lead-slot').length,
      });

      expect(counts()).toEqual({ art: ROW_COUNT, trailing: 0, lead: 0 });
      pick('Control style', 'Trailing button');
      expect(counts()).toEqual({ art: 0, trailing: ROW_COUNT, lead: 0 });
      pick('Control style', 'Leading slot');
      expect(counts()).toEqual({ art: 0, trailing: 0, lead: ROW_COUNT });
      expect(desktop().getAllByTestId('row-lead-control')).toHaveLength(ROW_COUNT);
    });

    it('marks no row at all while nothing is playing', () => {
      render(<DizajnPage />);
      expect(desktop().getAllByTestId('search-row').every((r) => r.dataset.active === 'false')).toBe(true);
      expect(desktop().queryAllByTestId('row-eq-bars')).toHaveLength(0);
      expect(desktop().queryAllByTestId('row-glyph')).toHaveLength(0);
      expect(desktop().queryByTestId('row-tint-edge')).toBeNull();
    });

    it('each indicator marks the playing row with its own markup', () => {
      render(<DizajnPage />);
      pick('Player state', 'This row playing');

      // Bars, the default.
      expect(desktop().getAllByTestId('row-eq-bars')).toHaveLength(1);
      expect(desktop().queryByTestId('row-ember-title')).toBeNull();
      expect(desktop().queryByTestId('row-tint-edge')).toBeNull();
      expect(desktop().queryAllByTestId('row-glyph')).toHaveLength(0);

      pick('Playing indicator', 'Ember title');
      expect(desktop().queryAllByTestId('row-eq-bars')).toHaveLength(0);
      const title = desktop().getAllByTestId('row-ember-title');
      expect(title).toHaveLength(1);
      expect(title[0]).toHaveClass('text-ember');
      expect(title[0]).toHaveTextContent(MOCK_SEARCH_RESULTS[1].title);
      expect(desktop().getAllByTestId('row-glyph')).toHaveLength(1);
      expect(desktop().queryByTestId('row-tint-edge')).toBeNull();

      pick('Playing indicator', 'Tinted row');
      expect(desktop().queryAllByTestId('row-eq-bars')).toHaveLength(0);
      expect(desktop().queryByTestId('row-ember-title')).toBeNull();
      expect(desktop().getAllByTestId('row-tint-edge')).toHaveLength(1);
      expect(desktop().getAllByTestId('row-glyph')).toHaveLength(1);
      expect(activeRow()).toHaveClass('bg-ember/10');
    });

    it('the playing and paused states differ on the row and on its control', () => {
      render(<DizajnPage />);
      const title = MOCK_SEARCH_RESULTS[1].title;

      pick('Player state', 'This row playing');
      expect(activeRow().dataset.playing).toBe('true');
      expect(within(activeRow()).getByTestId('row-eq-bars').dataset.playing).toBe('true');
      expect(within(activeRow()).getByTestId('row-eq-bars').querySelector('.ember-eq-bar')).not.toBeNull();
      expect(desktop().getByRole('button', { name: `Pause ${title}` })).toBeInTheDocument();

      pick('Player state', 'This row paused');
      expect(activeRow().dataset.playing).toBe('false');
      expect(within(activeRow()).getByTestId('row-eq-bars').dataset.playing).toBe('false');
      expect(within(activeRow()).getByTestId('row-eq-bars').querySelector('.ember-eq-bar')).toBeNull();
      expect(within(activeRow()).getByTestId('row-eq-bars').querySelector('.ember-eq-still')).not.toBeNull();
      expect(desktop().getByRole('button', { name: `Resume ${title}` })).toBeInTheDocument();
    });

    it('pressing a row control starts that row, and pressing it again pauses', () => {
      render(<DizajnPage />);
      const recent = MOCK_SEARCH_RECENTS[0].title;

      fireEvent.click(desktop().getByRole('button', { name: `Play ${recent}` }));
      expect(screen.getByRole('radio', { name: 'This row playing' })).toHaveAttribute('aria-checked', 'true');
      expect(activeRow()).toHaveTextContent(recent);

      fireEvent.click(desktop().getByRole('button', { name: `Pause ${recent}` }));
      expect(screen.getByRole('radio', { name: 'This row paused' })).toHaveAttribute('aria-checked', 'true');
    });

    it('pressing the row itself starts it too, for a phone with no hover', () => {
      render(<DizajnPage />);
      // Not the row the preview starts on, so the press has to move it.
      fireEvent.click(desktop().getAllByTestId('search-row')[5]);
      expect(screen.getByRole('radio', { name: 'This row playing' })).toHaveAttribute('aria-checked', 'true');
      expect(activeRow()).toHaveTextContent(MOCK_SEARCH_RESULTS[2].title);
    });

    it('marks On the art + Bars as the recommended combination', () => {
      render(<DizajnPage />);
      expect(RECOMMENDED_ROW).toEqual({ control: 'on-art', indicator: 'bars' });
      expect(within(section()).getByTestId('searchrows-recommended')).toHaveTextContent('Recommended');
      pick('Playing indicator', 'Tinted row');
      expect(within(section()).queryByTestId('searchrows-recommended')).toBeNull();
    });

    it('opens the desktop shell full screen and closes it with Escape', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen search rows preview' });
      expect(within(overlay).getByTestId('searchrows-overlay')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('searchrows-fullscreen')).not.toBeInTheDocument();
    });

    it('persists all three choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Control style', 'Leading slot');
      pick('Playing indicator', 'Tinted row');
      pick('Player state', 'This row paused');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-searchrows-control')).toBe('leading'));
      expect(window.localStorage.getItem('dizajn-searchrows-indicator')).toBe('tinted');
      expect(window.localStorage.getItem('dizajn-searchrows-state')).toBe('paused');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Leading slot' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Tinted row' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'This row paused' })).toHaveAttribute('aria-checked', 'true');
      expect(section().dataset).toMatchObject({ control: 'leading', indicator: 'tinted', state: 'paused' });
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-searchrows-control', 'floating');
      window.localStorage.setItem('dizajn-searchrows-indicator', 'halo');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'On the art' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Bars' })).toHaveAttribute('aria-checked', 'true');
    });

    // Reduced motion is handled in CSS, not with a matchMedia check in the
    // component, so assert the guard itself: the bars must fall back to the
    // same still shape the paused state uses.
    it('globals.css freezes the bars under prefers-reduced-motion', () => {
      const css = readFileSync(join(__dirname, '..', '..', 'globals.css'), 'utf8');
      expect(css).toMatch(/\.ember-eq-bar\s*\{\s*animation:\s*ember-eq/);
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ember-eq-bar\s*\{\s*animation:\s*none !important;\s*transform:\s*scaleY\(0\.5\);\s*\}\s*\}/,
      );
    });
  });
});
