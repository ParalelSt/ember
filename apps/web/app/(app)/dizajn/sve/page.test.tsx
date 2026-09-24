import type { ComponentProps, PropsWithChildren } from 'react';
import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DizajnPage from './page';
import { SHELF_OPTIONS } from '@/components/library/options';
import { SPACING_SCALE } from '@/lib/spacing';
import { MOCK_LIKED_TRACKS, MOCK_TAB_SOURCES } from '../mock';
import { CHANGELOG_PLACEMENTS, CHANGELOG_STATES, BADGE_STYLES } from '@/components/library/options/changelog';
import {
  IMPORT_CHOICE_STYLES,
  IMPORT_REVIEW_STYLES,
  IMPORT_SOURCES,
  IMPORT_STEPS,
} from '@/components/library/options/imports';
import { MOCK_IMPORT_ITEMS } from '../mock';
import { TRENDING_DATA, TRENDING_OPTIONS, TRENDING_VIEWS } from '@/components/library/options/trending';
import { MOCK_CHART } from '../mock';
import { ROW_STATES } from '@/components/library/options/searchrows';
import { MOCK_SEARCH_RECENTS, MOCK_SEARCH_RESULTS } from '../mock';
import { MOCK_MOBILE_NOW_PLAYING } from '../mock';
import { MOCK_PHONE_SEARCH_PLAYING, MOCK_PHONE_SEARCH_RECENTS, MOCK_PHONE_SEARCH_RESULTS } from '../mock';
import {
  PHONE_SEARCH_OPTIONS,
  PHONE_SEARCH_RECOMMENDED,
  PHONE_SEARCH_STATES,
} from '@/components/library/options/phonesearch';
import {
  TABS_LAYOUTS,
  TABS_PASTE,
  TABS_SCROLL,
  TABS_STAFF,
  TABS_V3_PICKER,
  TABS_V3_STATE,
} from '@/components/library/options/tabs';
import { PASTE_SAMPLE_TEXT } from '@/components/library/options/tabs/pasteSample';
import { SAMPLE_TEX } from '@/components/library/options/tabs/sample';

// AlphaTab needs a real browser (canvas, fonts, layout), so the Guitar tabs
// section gets a fake module: it records every AlphaTabApi built (host,
// settings, the alphaTex and tracks it was given), answers the one bounds
// lookup the cursor needs, and fires postRenderFinished like the real one.
const alphaTab = vi.hoisted(() => ({ apis: [] as FakeApi[] }));
interface FakeApi {
  host: HTMLElement;
  settings: Record<string, Record<string, unknown>>;
  texArgs: { tex: string; tracks: number[] } | null;
  destroyed: boolean;
}
vi.mock('@coderline/alphatab', () => {
  class Emitter {
    private fns: (() => void)[] = [];
    on(fn: () => void) {
      this.fns.push(fn);
    }
    emit() {
      this.fns.forEach((f) => f());
    }
  }
  const bar = (n: number) => ({ voices: [{ beats: Array.from({ length: n }, () => ({})) }] });
  class AlphaTabApi {
    postRenderFinished = new Emitter();
    error = new Emitter();
    score: unknown = null;
    renderer = {
      boundsLookup: {
        findBeat: () => ({
          visualBounds: { x: 120, y: 10, w: 10, h: 60 },
          barBounds: { masterBarBounds: { visualBounds: { x: 90, y: 10, w: 220, h: 90 } } },
        }),
      },
    };
    texArgs: FakeApi['texArgs'] = null;
    destroyed = false;
    constructor(
      public host: HTMLElement,
      public settings: FakeApi['settings'],
    ) {
      alphaTab.apis.push(this);
    }
    tex(tex: string, tracks: number[]) {
      this.texArgs = { tex, tracks };
      const track = { staves: [{ bars: [bar(8), bar(8)] }] };
      this.score = { tracks: [track, track] };
      queueMicrotask(() => this.postRenderFinished.emit());
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const names = ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic',
    'ScoreWordsAndMusic', 'ScoreCopyright', 'GuitarTuning', 'TrackNames', 'EffectDynamics'];
  return {
    AlphaTabApi,
    StaveProfile: { Default: 0, ScoreTab: 1, Score: 2, Tab: 3 },
    LayoutMode: { Page: 0, Horizontal: 1 },
    TabRhythmMode: { Hidden: 0, ShowWithBeams: 1, ShowWithBars: 2 },
    NotationElement: Object.fromEntries(names.map((n, i) => [n, i])),
  };
});

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

// base-ui's Slider reaches the repo root's hoisted React 18 through its own
// copy, so it cannot render under happy-dom (see SeekBar.test.tsx, which
// covers the real seek behaviour). The bar only needs it to be *there*.
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ className }: { className?: string }) => (
    <input type="range" aria-label="progress" className={className} readOnly />
  ),
}));

// happy-dom lays nothing out; the score waits for a real width first.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

beforeEach(() => {
  window.localStorage.clear();
  alphaTab.apis.length = 0;
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

// The archive renders every past /dizajn candidate at once, which takes a
// few seconds when the whole suite runs in parallel: allow 20 s per test
// instead of 5 so a busy machine doesn't fail it.
describe('DizajnPage', { timeout: 20_000 }, () => {
  it('renders every section with no network', () => {
    render(<DizajnPage />);

    expect(screen.getByText('Phone search', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('Mobile player')).toBeInTheDocument();
    expect(screen.getByText('Search rows')).toBeInTheDocument();
    expect(screen.getByText('Playlist import')).toBeInTheDocument();
    expect(screen.getByText('Trending shelf')).toBeInTheDocument();
    expect(screen.getByText('Guitar tabs')).toBeInTheDocument();
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
      expect(sectionHeadings().slice(0, 4)).toEqual(['Phone search', 'Mobile player', 'Search rows', 'Playlist import']);
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
      expect(headings[4]).toBe('Trending shelf');
      expect(headings.indexOf("What's new (changelog)")).toBeGreaterThan(4);
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

  describe('Phone search section', () => {
    const section = () => screen.getByTestId('phonesearch-section');
    const frames = () => within(section()).getAllByTestId('phonesearch-frame');
    const group = (name: string) => screen.getByRole('radiogroup', { name });
    const pick = (groupName: string, id: string, options: { id: string; name: string }[]) => {
      const name = options.find((o) => o.id === id)!.name;
      fireEvent.click(within(group(groupName)).getByRole('radio', { name: new RegExp(`^${name}`) }));
    };
    const pickOption = (id: string) => pick('Phone search', id, PHONE_SEARCH_OPTIONS);
    const pickState = (id: string) => pick('Search state', id, PHONE_SEARCH_STATES);
    const checkedName = (name: string) =>
      within(group(name))
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true')
        .map((r) => r.textContent);

    it('is the first section on the page, in the three phone frames with the Android strip on two', () => {
      render(<DizajnPage />);
      expect(sectionHeadings()[0]).toBe('Phone search');
      expect(frames().map((f) => f.dataset.frame)).toEqual(['clean-390', 'android-390', 'android-360']);
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual([
        'true',
        'true',
        'true',
      ]);
      expect(within(section()).getAllByTestId('android-nav-strip')).toHaveLength(2);
      // The Android frames publish the strip's height, the clean one nothing.
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.bottomInset)).toEqual([
        '0',
        '48',
        '48',
      ]);
    });

    it('has two radiogroups with correct aria-checked, opening on the recommended candidate, playing', () => {
      render(<DizajnPage />);
      const options = within(group('Phone search')).getAllByRole('radio');
      expect(options.map((r) => r.textContent)).toEqual(
        PHONE_SEARCH_OPTIONS.map((o) => o.name + (o.badge ?? '')),
      );
      expect(PHONE_SEARCH_OPTIONS.map((o) => o.name)).toEqual([
        'Sheet above the player',
        'Search page',
        'Mini player in the sheet',
      ]);
      const states = within(group('Search state')).getAllByRole('radio');
      expect(states.map((r) => r.textContent)).toEqual(['Typing', 'Playing from search', 'Nothing typed']);

      expect(checkedName('Phone search')).toEqual(['Sheet above the playerRecommended']);
      expect(checkedName('Search state')).toEqual(['Playing from search']);

      pickOption('mini-player');
      pickState('empty');
      expect(checkedName('Phone search')).toEqual(['Mini player in the sheet']);
      expect(checkedName('Search state')).toEqual(['Nothing typed']);
      // Exactly one checked radio per group, always.
      for (const name of ['Phone search', 'Search state']) {
        expect(within(group(name)).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
      }
    });

    it('marks exactly one candidate Recommended, with its reason', () => {
      render(<DizajnPage />);
      expect(PHONE_SEARCH_OPTIONS.filter((o) => o.badge === 'Recommended').map((o) => o.id)).toEqual([
        PHONE_SEARCH_RECOMMENDED,
      ]);
      expect(screen.getByTestId('phonesearch-recommended')).toHaveTextContent('Recommended: Sheet above the player.');
    });

    it('says what each candidate does with the keyboard, the back gesture and closing', () => {
      render(<DizajnPage />);
      const seen = new Set<string>();
      for (const o of PHONE_SEARCH_OPTIONS) {
        pickOption(o.id);
        expect(within(section()).getByTestId('phonesearch-keyboard')).toHaveTextContent(o.keyboard);
        expect(within(section()).getByTestId('phonesearch-back')).toHaveTextContent(o.back);
        expect(within(section()).getByTestId('phonesearch-close')).toHaveTextContent(o.close);
        seen.add(o.keyboard + o.back + o.close);
      }
      expect(seen.size).toBe(3);
    });

    it('Sheet above the player: the sheet ends above the real bar and the nav, which stay uncovered', () => {
      render(<DizajnPage />);
      pickOption('sheet-above');
      for (const frame of frames()) {
        const shell = within(frame).getByTestId('shell-preview');
        const sheet = within(frame).getByTestId('phonesearch-sheet');
        const bar = within(frame).getByTestId('phone-player-bar');
        const nav = within(frame).getByTestId('mock-mobile-nav');
        expect(sheet.dataset.coversPlayer).toBe('false');
        // Inside the shell's above-the-bar layer, and that layer is not
        // an ancestor of the bar or the nav: it ends where the bar begins.
        const layer = within(shell).getByTestId('shell-sheet-layer');
        expect(layer).toContainElement(sheet);
        expect(layer.contains(bar)).toBe(false);
        expect(layer.contains(nav)).toBe(false);
        expect(layer.parentElement!.compareDocumentPosition(bar.closest('footer')!)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(within(frame).queryByTestId('phonesearch-mini-strip')).toBeNull();
        expect(within(frame).queryByTestId('phonesearch-page')).toBeNull();
      }
    });

    it('Search page: no sheet at all, the page in the content column, Search lit in the nav', () => {
      render(<DizajnPage />);
      pickOption('search-page');
      for (const frame of frames()) {
        expect(within(frame).queryByTestId('phonesearch-sheet')).toBeNull();
        expect(within(frame).queryByTestId('shell-sheet-layer')).toBeNull();
        expect(within(frame).queryByTestId('phonesearch-mini-strip')).toBeNull();
        const page = within(frame).getByTestId('phonesearch-page');
        expect(page.closest('main')).not.toBeNull();
        expect(within(page).getByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
        // The page has nothing to close.
        expect(within(page).queryByRole('button', { name: 'Close search' })).toBeNull();
        expect(within(frame).getByTestId('phone-player-bar')).toBeInTheDocument();
        const nav = within(frame).getByTestId('mock-mobile-nav');
        expect(within(nav).getByText('Search')).toHaveClass('text-foreground');
        expect(within(nav).getByText('Home')).toHaveClass('text-foreground/55');
      }
    });

    it('Mini player in the sheet: a full-screen sheet with the now-playing strip pinned at its bottom', () => {
      render(<DizajnPage />);
      pickOption('mini-player');
      for (const frame of frames()) {
        const sheet = within(frame).getByTestId('phonesearch-sheet');
        expect(sheet.dataset.coversPlayer).toBe('true');
        expect(within(frame).queryByTestId('shell-sheet-layer')).toBeNull();
        const strip = within(sheet).getByTestId('phonesearch-mini-strip');
        expect(sheet.lastElementChild).toBe(strip);
        expect(within(strip).getByText(MOCK_PHONE_SEARCH_PLAYING.title)).toBeInTheDocument();
        expect(within(strip).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        // The real bar is still rendered, under the sheet, not inside it.
        expect(sheet.contains(within(frame).getByTestId('phone-player-bar'))).toBe(false);
      }
    });

    it('the three candidates are structurally distinct', () => {
      render(<DizajnPage />);
      const shape = () => {
        const f = frames()[0];
        return [
          within(f).queryByTestId('shell-sheet-layer') !== null,
          within(f).queryByTestId('phonesearch-page') !== null,
          within(f).queryByTestId('phonesearch-mini-strip') !== null,
        ].join();
      };
      const shapes = PHONE_SEARCH_OPTIONS.map((o) => {
        pickOption(o.id);
        return shape();
      });
      expect(shapes).toEqual(['true,false,false', 'false,true,false', 'false,false,true']);
    });

    it('the states differ: keyboard and focus, the playing row and bar, recents only', () => {
      render(<DizajnPage />);
      for (const o of PHONE_SEARCH_OPTIONS) {
        pickOption(o.id);
        const frame = () => frames()[1];
        const titles = () => within(frame()).queryAllByTestId('track-row-title');
        const emberTitles = () => titles().filter((t) => t.className.includes('text-ember'));

        pickState('typing');
        expect(within(frame()).getByTestId('mock-keyboard')).toBeInTheDocument();
        expect(within(frame()).getByRole('textbox', { name: 'Search' })).toHaveAttribute('data-focused', 'true');
        expect(within(frame()).getByRole('textbox', { name: 'Search' })).toHaveValue('harbour');
        expect(within(frame()).getByTestId('phonesearch-results')).toBeInTheDocument();
        expect(emberTitles()).toHaveLength(0);
        expect(within(within(frame()).getByTestId('phone-player-bar')).getAllByText(MOCK_MOBILE_NOW_PLAYING.title).length).toBeGreaterThan(0);

        pickState('playing');
        expect(within(frame()).queryByTestId('mock-keyboard')).toBeNull();
        expect(emberTitles().map((t) => t.textContent)).toEqual([MOCK_PHONE_SEARCH_PLAYING.title]);
        const playingRow = emberTitles()[0].closest('[data-testid="track-row"]') as HTMLElement | null;
        expect(playingRow).not.toBeNull();
        expect(within(playingRow!).getByRole('button', { name: /pause/i })).toBeInTheDocument();
        const bar = within(frame()).getByTestId('phone-player-bar');
        expect(within(bar).getAllByText(MOCK_PHONE_SEARCH_PLAYING.title).length).toBeGreaterThan(0);
        expect(within(bar).getByRole('button', { name: 'Pause' })).toBeInTheDocument();

        pickState('empty');
        expect(within(frame()).queryByTestId('mock-keyboard')).toBeNull();
        expect(within(frame()).queryByTestId('phonesearch-results')).toBeNull();
        expect(within(frame()).getByRole('textbox', { name: 'Search' })).toHaveValue('');
        const recents = within(frame()).getByTestId('phonesearch-recents');
        expect(within(recents).getAllByTestId('track-row-title').map((t) => t.textContent)).toEqual(
          MOCK_PHONE_SEARCH_RECENTS.map((t) => t.title),
        );
        expect(within(frame()).queryByText(MOCK_PHONE_SEARCH_RESULTS[0].title)).toBeNull();
      }
    });

    it('saves both choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pickOption('search-page');
      pickState('typing');
      await waitFor(() => expect(window.localStorage.getItem('dizajn-phonesearch-option')).toBe('search-page'));
      expect(window.localStorage.getItem('dizajn-phonesearch-state')).toBe('typing');
      unmount();

      render(<DizajnPage />);
      expect(checkedName('Phone search')).toEqual(['Search page']);
      expect(checkedName('Search state')).toEqual(['Typing']);
      expect(section().dataset.option).toBe('search-page');
      expect(section().dataset.state).toBe('typing');
    });

    it('ignores a stale saved choice and falls back to the defaults', () => {
      window.localStorage.setItem('dizajn-phonesearch-option', 'bottom-drawer');
      window.localStorage.setItem('dizajn-phonesearch-state', 'loading');
      render(<DizajnPage />);
      expect(section().dataset.option).toBe('sheet-above');
      expect(section().dataset.state).toBe('playing');
    });
  });

  describe('Mobile player section', () => {
    const section = () => screen.getByTestId('mobileplayer-section');
    const bars = () => within(section()).getAllByTestId('phone-player-bar');
    const FRAME_COUNT = 3;

    it('sits right below Phone search, three phone frames, two of them with the Android strip', () => {
      render(<DizajnPage />);
      expect(sectionHeadings()[1]).toBe('Mobile player');

      const frames = within(section()).getAllByTestId('mobileplayer-frame');
      expect(frames.map((f) => f.dataset.frame)).toEqual(['clean-390', 'android-390', 'android-360']);
      // Every frame is the phone shell, never the desktop one.
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(
        Array(FRAME_COUNT).fill('true'),
      );
      expect(within(section()).getAllByTestId('android-nav-strip')).toHaveLength(2);
    });

    // The point of the section after the pick: it draws the shipping bar,
    // not a copy of it, so it cannot drift from what the app renders.
    it('draws the REAL PhonePlayerBar: artwork, name, play and next, no pickers left', () => {
      render(<DizajnPage />);
      expect(bars()).toHaveLength(FRAME_COUNT);
      for (const bar of bars()) {
        expect(bar.querySelector('[data-testid="phone-player-title-row"] .size-art-bar')).not.toBeNull();
        // The shipped play button: a 40px disc inside the 48px hit box.
        expect(within(bar).getByRole('button', { name: 'Pause' })).toHaveClass('size-12');
        expect(within(bar).getByTestId('phone-play-disc')).toHaveClass('size-10', 'bg-foreground');
        // The size presets are gone: the bar takes no size or style.
        expect(bar.dataset.size).toBeUndefined();
        expect(bar.dataset.playStyle).toBeUndefined();
        expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open player', 'Pause', 'Next']);
        for (const name of ['Previous', 'Queue']) {
          expect(within(bar).queryByRole('button', { name })).toBeNull();
        }
        // Mock candidates tagged themselves; the real bar does not.
        expect(bar.dataset.variant).toBeUndefined();
      }
      // The Arrangement picker and every older one are gone.
      for (const group of ['Arrangement', 'Bar layout', 'Title', 'Bottom inset', 'Bar size', 'Play style']) {
        expect(screen.queryByRole('radiogroup', { name: group })).toBeNull();
      }
      expect(screen.queryByTestId('mobileplayer-comparison')).toBeNull();
      expect(within(section()).queryByTestId('mobile-player-bar')).toBeNull();
      expect(within(section()).queryByTestId('mobileplayer-sizes')).toBeNull();
      expect(within(section()).queryByTestId('mobileplayer-recommended')).toBeNull();
    });

    it('keeps no size picker choice in localStorage', () => {
      window.localStorage.setItem('dizajn-mobileplayer-size', 'art');
      window.localStorage.setItem('dizajn-mobileplayer-play-style', 'icon');
      render(<DizajnPage />);
      // A choice saved before the pickers were removed changes nothing.
      for (const bar of bars()) {
        expect(bar.querySelector('.size-art-bar')).not.toBeNull();
        expect(within(bar).getByTestId('phone-play-disc')).toBeInTheDocument();
      }
    });

    it('scrolls the song name with the real MarqueeText', () => {
      render(<DizajnPage />);
      // MarqueeText draws its invisible measuring ruler beside the title, so
      // the name appears more than once inside the marquee box.
      const marquee = within(bars()[0]).getByTestId('marquee');
      expect(within(marquee).getAllByText(MOCK_MOBILE_NOW_PLAYING.title)).not.toHaveLength(0);
    });

    it('lifts only the nav by the safe-area inset in every frame, not the bar too', () => {
      render(<DizajnPage />);
      const shells = within(section()).getAllByTestId('shell-preview');
      expect(shells).toHaveLength(FRAME_COUNT);
      for (const shell of shells) {
        // The frame publishes the inset the phone publishes from its window.
        expect(shell.dataset.bottomInset).toBe('48');
        expect(shell.style.getPropertyValue('--safe-bottom')).toBe('48px');
      }
      // The bar itself spends none of it: MobileNav below it is the
      // bottom-most element in the shell, so only it carries the lift.
      // Applying it to both left an empty 48px band under the seek line.
      for (const bar of bars()) {
        expect(bar.closest('footer')).not.toHaveClass('safe-area-bottom');
      }
      const navs = within(section()).getAllByTestId('mock-mobile-nav');
      expect(navs).toHaveLength(FRAME_COUNT);
      for (const nav of navs) expect(nav).toHaveClass('safe-area-bottom');
    });

    it('quotes the shipped tap targets and what they replaced', () => {
      render(<DizajnPage />);
      const taps = within(section()).getByTestId('mobileplayer-taps');
      expect(taps).toHaveTextContent('play 48px (a 40px disc inside it), next 48px (24px glyph), artwork 56px (previous and queue: full-screen view)');
      expect(taps).toHaveTextContent('176px at 390, 146px at 360');
      expect(taps).toHaveTextContent('Bar height: 100px');
      expect(taps).toHaveTextContent('The phone bar before this work, for comparison');
      expect(taps).toHaveTextContent('play 40px, prev/next 32px, queue 40px, artwork 48px');
    });
  });

  describe('Search rows section', () => {
    const pick = (group: string, name: string) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));
    const section = () => screen.getByTestId('searchrows-section');
    // Both frames draw the same overlay; the desktop one is the first.
    const desktop = () => within(within(section()).getAllByTestId('searchrows-overlay')[0]);
    const titles = () => desktop().getAllByTestId('track-row-title');
    const emberTitles = () => titles().filter((t) => t.className.includes('text-ember'));
    const ROW_COUNT = MOCK_SEARCH_RECENTS.length + MOCK_SEARCH_RESULTS.length;
    const PLAYING = MOCK_SEARCH_RESULTS[1].title;

    it('sits right below Mobile player, in the desktop and phone shells', () => {
      render(<DizajnPage />);
      expect(sectionHeadings()[2]).toBe('Search rows');
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
    });

    it('keeps only the Player state picker now that the combination is chosen', () => {
      render(<DizajnPage />);
      const radios = within(screen.getByRole('radiogroup', { name: 'Player state' })).getAllByRole('radio');
      expect(radios.map((r) => r.textContent)).toEqual(ROW_STATES.map((o) => o.name));
      radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      expect(ROW_STATES.map((o) => o.name)).toEqual(['Nothing playing', 'This row playing', 'This row paused']);
      expect(screen.queryByRole('radiogroup', { name: 'Control style' })).toBeNull();
      expect(screen.queryByRole('radiogroup', { name: 'Playing indicator' })).toBeNull();
    });

    // The point of the trim: no copy of the rows any more. The results come
    // through the real TrackList (its rows carry TrackRow's own testid) and
    // the recents through the real compact TrackRow.
    it('draws the overlay with the real production rows, recents above the results', () => {
      render(<DizajnPage />);
      expect(within(section()).getAllByTestId('searchrows-overlay')).toHaveLength(2);
      expect(desktop().getByText('Recent searches')).toBeInTheDocument();
      expect(titles()).toHaveLength(ROW_COUNT);
      expect(titles().slice(0, 3).map((t) => t.textContent)).toEqual(MOCK_SEARCH_RECENTS.map((t) => t.title));
      // Only the list rows are TrackList's; the three recents are compact.
      expect(desktop().getAllByTestId('track-row')).toHaveLength(MOCK_SEARCH_RESULTS.length);
      for (const t of MOCK_SEARCH_RESULTS) expect(desktop().getByText(t.title)).toBeInTheDocument();
    });

    it('gives every row a trailing play button and marks no row while nothing is playing', () => {
      render(<DizajnPage />);
      expect(desktop().getAllByTestId('track-row-play')).toHaveLength(ROW_COUNT);
      expect(emberTitles()).toHaveLength(0);
      for (const t of [...MOCK_SEARCH_RECENTS, ...MOCK_SEARCH_RESULTS]) {
        expect(desktop().getByRole('button', { name: `Play ${t.title}` })).toBeInTheDocument();
      }
    });

    it('marks the playing row with its title in ember and no glyph, in both states', () => {
      render(<DizajnPage />);

      pick('Player state', 'This row playing');
      expect(emberTitles().map((t) => t.textContent)).toEqual([PLAYING]);
      expect(desktop().getByRole('button', { name: `Pause ${PLAYING}` })).toBeInTheDocument();
      // The title cell carries the colour and nothing else: no speaker or
      // pause glyph beside it, which is what the owner picked.
      expect(emberTitles()[0].querySelector('svg')).toBeNull();

      pick('Player state', 'This row paused');
      expect(emberTitles().map((t) => t.textContent)).toEqual([PLAYING]);
      expect(desktop().getByRole('button', { name: `Resume ${PLAYING}` })).toBeInTheDocument();
      expect(emberTitles()[0].querySelector('svg')).toBeNull();
    });

    it('pressing a row control starts that row, and pressing it again pauses', () => {
      render(<DizajnPage />);
      const recent = MOCK_SEARCH_RECENTS[0].title;

      fireEvent.click(desktop().getByRole('button', { name: `Play ${recent}` }));
      expect(screen.getByRole('radio', { name: 'This row playing' })).toHaveAttribute('aria-checked', 'true');
      expect(emberTitles().map((t) => t.textContent)).toEqual([recent]);

      fireEvent.click(desktop().getByRole('button', { name: `Pause ${recent}` }));
      expect(screen.getByRole('radio', { name: 'This row paused' })).toHaveAttribute('aria-checked', 'true');
      expect(emberTitles().map((t) => t.textContent)).toEqual([recent]);
    });

    it('opens the desktop shell full screen and closes it with Escape', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen search rows preview' });
      expect(within(overlay).getByTestId('searchrows-overlay')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('searchrows-fullscreen')).not.toBeInTheDocument();
    });

    it('persists the player state to localStorage and restores it on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Player state', 'This row paused');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-searchrows-state')).toBe('paused'));
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'This row paused' })).toHaveAttribute('aria-checked', 'true');
      expect(section().dataset).toMatchObject({ state: 'paused' });
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-searchrows-state', 'halo');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Nothing playing' })).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('Tabs v3: found online (Guitar tabs)', () => {
    const group = (name: string) => screen.getByRole('radiogroup', { name });
    const pick = (g: string, name: string | RegExp) => fireEvent.click(within(group(g)).getByRole('radio', { name }));
    const v3 = () => screen.getByTestId('tabs-v3-section');
    const v3Apis = () => alphaTab.apis.filter((a) => !a.destroyed && v3().contains(a.host));

    it('sits at the top of Guitar tabs, marked as a preview of the planned design', () => {
      render(<DizajnPage />);
      const block = screen.getByTestId('tabs-v3-block');
      expect(within(block).getByRole('heading', { level: 3 })).toHaveTextContent('Tabs v3: found online');
      expect(block).toHaveTextContent('Preview of the planned design, not built yet');
      // Before the older layout candidates and the paste candidates.
      expect(block.compareDocumentPosition(screen.getByTestId('tabs-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(v3()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
    });

    it('offers both pickers as radiogroups, Picker menu (Recommended) and Found first', () => {
      render(<DizajnPage />);
      const pickers = within(group('Source picker')).getAllByRole('radio');
      expect(pickers.map((r) => r.textContent)).toEqual(['Picker menuRecommended', 'Source sheet']);
      expect(pickers.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      const states = within(group('Page state')).getAllByRole('radio');
      expect(states.map((r) => r.textContent)).toEqual([
        'Searching online',
        'Found and lined up',
        'Not lined up yet',
        'Nothing online',
      ]);
      expect(states.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
      expect(TABS_V3_PICKER.map((o) => o.name)).toEqual(['Picker menu', 'Source sheet']);
      expect(TABS_V3_STATE.map((o) => o.id)).toEqual(['searching', 'found', 'not-lined-up', 'nothing']);
    });

    it('Searching online: a skeleton score and the sites being checked, no score drawn', () => {
      render(<DizajnPage />);
      expect(v3().dataset.state).toBe('searching');
      expect(within(v3()).getAllByTestId('v3-searching')).toHaveLength(2);
      expect(within(v3()).getAllByTestId('v3-score-skeleton')).toHaveLength(2);
      expect(within(v3()).getAllByText('Looking for tabs for Copper Sky by Coastline…')).toHaveLength(2);
      expect(within(within(v3()).getAllByTestId('v3-searching')[0]).getByText('Ultimate Guitar')).toBeInTheDocument();
      expect(within(v3()).getAllByTestId('v3-source-trigger')[0]).toHaveTextContent('Searching online…');
      expect(within(v3()).queryByTestId('tab-score')).toBeNull();
      expect(screen.getByTestId('tabs-v3-state-description').textContent).toBe(TABS_V3_STATE[0].description);
    });

    it('Found and lined up: the real score, the chip says Songsterr, lined up, with the confidence', async () => {
      render(<DizajnPage />);
      pick('Page state', 'Found and lined up');
      const triggers = within(v3()).getAllByTestId('v3-source-trigger');
      for (const t of triggers) expect(t).toHaveTextContent('Songsterr, lined up94%');
      expect(within(v3()).getAllByTestId('tabs-toolbar')).toHaveLength(2);
      expect(within(v3()).queryByTestId('v3-not-lined')).toBeNull();
      await waitFor(() => expect(v3Apis()).toHaveLength(2));
      for (const api of v3Apis()) expect(api.texArgs).toEqual({ tex: SAMPLE_TEX, tracks: [0] });
    });

    it('Not lined up yet: the score still draws, with the calm note, Line it up and the Sync nudge', async () => {
      render(<DizajnPage />);
      pick('Page state', 'Not lined up yet');
      for (const t of within(v3()).getAllByTestId('v3-source-trigger')) {
        expect(t).toHaveTextContent('Songsterr, not lined up yet');
      }
      const notes = within(v3()).getAllByTestId('v3-not-lined');
      expect(notes).toHaveLength(2);
      expect(within(notes[0]).getByRole('button', { name: 'Line it up' })).toBeInTheDocument();
      expect(notes[0]).toHaveTextContent('41% sure');
      expect(within(v3()).getAllByTestId('v3-sync')).toHaveLength(2);
      await waitFor(() => expect(v3Apis()).toHaveLength(2));
    });

    it('Nothing online: search links, Paste a tab, Add a file, and the rough generated tab last', () => {
      render(<DizajnPage />);
      pick('Page state', 'Nothing online');
      const empty = within(v3()).getAllByTestId('v3-nothing')[0];
      expect(within(empty).getByRole('link', { name: 'Ultimate Guitar' })).toHaveAttribute(
        'href',
        'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky',
      );
      const buttons = within(empty).getAllByRole('button').map((b) => b.textContent);
      expect(buttons).toEqual(['Paste a tab', 'Add a file', 'Generate from the recording (rough)']);
      expect(within(v3()).queryByTestId('tab-score')).toBeNull();
      expect(within(v3()).getAllByTestId('v3-source-trigger')[0]).toHaveTextContent('Nothing found online');
    });

    it('Picker menu: every source in rank order with site, type, rating, instruments and alignment', () => {
      render(<DizajnPage />);
      pick('Page state', 'Found and lined up');
      const menus = within(v3()).getAllByTestId('v3-picker-menu');
      expect(menus).toHaveLength(2);
      expect(within(v3()).queryByTestId('tab-source-sheet')).toBeNull();
      const menu = menus[0];
      expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
        'Songsterr',
        'Ultimate Guitar',
        'On this server',
      ]);
      const rows = within(menu).getAllByRole('menuitemradio');
      expect(rows).toHaveLength(MOCK_TAB_SOURCES.length);
      expect(rows[0]).toHaveAttribute('aria-checked', 'true');
      expect(rows[0]).toHaveTextContent('Tab with rhythm · Guitar, Bass, Drums');
      expect(rows[0]).toHaveTextContent('Lined up 94%');
      expect(rows[1]).toHaveTextContent('4.8 · 1,204');
      expect(rows[2]).toHaveTextContent('4.5 · 310');
      expect(rows[2]).toHaveTextContent('Not lined up yet');
      expect(rows[3]).toHaveTextContent('Bass tab · Bass');
      expect(rows[3]).toHaveTextContent('3.9 · 22');
      expect(rows[4]).toHaveTextContent('Text tab pasted by Mira');
      expect(rows[5]).toHaveTextContent('Generated from the recording, rough');
      // The long name and instrument list truncate, with the full text on hover.
      const longName = within(rows[3]).getByTitle(MOCK_TAB_SOURCES[3].name);
      expect(longName.className).toContain('truncate');
      expect(within(menu).getByRole('menuitem', { name: 'Line it up again' })).toBeInTheDocument();

      // Picking a row switches the chip and closes the menu; the chip reopens it.
      fireEvent.click(rows[1]);
      expect(within(v3()).queryByTestId('v3-picker-menu')).toBeNull();
      const trigger = within(v3()).getAllByTestId('v3-source-trigger')[0];
      expect(trigger).toHaveTextContent('Ultimate Guitar, ver 2, lined up81%');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(trigger);
      expect(within(v3()).getAllByTestId('v3-picker-menu')).toHaveLength(2);
    });

    it('Source sheet: a side sheet on desktop and a bottom sheet on phone, a card per source', () => {
      render(<DizajnPage />);
      pick('Source picker', 'Source sheet');
      pick('Page state', 'Found and lined up');
      expect(v3().dataset.picker).toBe('sheet');
      expect(within(v3()).queryByTestId('v3-picker-menu')).toBeNull();
      // The gallery renders the production sheet itself
      // (components/tabs/TabSourceSheet.tsx) with mock rows.
      const sheets = within(v3()).getAllByTestId('tab-source-sheet');
      expect(sheets).toHaveLength(2);
      expect(sheets[0].tagName).toBe('ASIDE');
      const cards = within(sheets[1]).getAllByTestId('tab-source-row');
      expect(cards).toHaveLength(MOCK_TAB_SOURCES.length);
      expect(within(cards[0]).getByRole('radio')).toHaveAttribute('aria-checked', 'true');
      expect(cards[0]).toHaveTextContent('Best match');
      expect(cards[1]).toHaveTextContent('★ 4.8 (1,204 votes)');
      expect(cards[2]).toHaveTextContent('Lead Guitar (Fender Jaguar, fuzz)');
      expect(screen.getByTestId('tabs-v3-description').textContent).toBe(TABS_V3_PICKER[1].description);

      fireEvent.click(within(sheets[0]).getByRole('button', { name: 'Close the tab list' }));
      expect(within(v3()).queryByTestId('tab-source-sheet')).toBeNull();
      fireEvent.click(within(v3()).getAllByTestId('v3-source-trigger')[1]);
      expect(within(v3()).getAllByTestId('tab-source-sheet')).toHaveLength(2);
    });

    it('opens full screen and closes with Escape', () => {
      render(<DizajnPage />);
      fireEvent.click(within(v3()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen tabs v3 preview' });
      expect(within(overlay).getByTestId('v3-page')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('tabs-v3-fullscreen')).not.toBeInTheDocument();
    });

    it('persists both choices to localStorage, restores them on mount and ignores stale ones', () => {
      const { unmount } = render(<DizajnPage />);
      pick('Source picker', 'Source sheet');
      pick('Page state', 'Nothing online');
      expect(window.localStorage.getItem('dizajn-tabs-v3-picker')).toBe('sheet');
      expect(window.localStorage.getItem('dizajn-tabs-v3-state')).toBe('nothing');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Source sheet' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Nothing online' })).toHaveAttribute('aria-checked', 'true');
      expect(v3().dataset).toMatchObject({ picker: 'sheet', state: 'nothing' });
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-tabs-v3-picker', 'carousel');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: /Picker menu/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('renders the first option on the server and the saved one after hydration (no #418)', async () => {
      window.localStorage.setItem('dizajn-tabs-v3-state', 'found');
      window.localStorage.setItem('dizajn-tabs-layout', 'stage');
      const { renderToString } = await import('react-dom/server');
      const html = renderToString(<DizajnPage />);
      expect(html).toContain('data-state="searching"');
      expect(html).toContain('data-layout="sheet"');

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { hydrateRoot } = await import('react-dom/client');
      const { act } = await import('react');
      let root: ReturnType<typeof hydrateRoot> | undefined;
      const recoverable: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(container, <DizajnPage />, { onRecoverableError: (e) => recoverable.push(e) });
      });
      expect(recoverable).toEqual([]);
      expect(container.querySelector('[data-testid="tabs-v3-section"]')?.getAttribute('data-state')).toBe('found');
      expect(container.querySelector('[data-testid="tabs-section"]')?.getAttribute('data-layout')).toBe('stage');
      errors.mockRestore();
      await act(async () => root?.unmount());
      container.remove();
    });
  });

  describe('Guitar tabs section', () => {
    const pick = (group: string, name: string | RegExp) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }));
    const section = () => screen.getByTestId('tabs-section');
    const scores = () => within(section()).getAllByTestId('tab-score');
    // The paste candidates below draw their own scores: count only these.
    const live = () => alphaTab.apis.filter((a) => !a.destroyed && section().contains(a.host));

    it('is its own section, straight after Trending shelf and before the changelog', () => {
      render(<DizajnPage />);
      const headings = sectionHeadings();
      expect(headings).toContain('Guitar tabs');
      expect(headings.indexOf('Guitar tabs')).toBe(headings.indexOf('Trending shelf') + 1);
      expect(headings.indexOf('Guitar tabs')).toBeLessThan(headings.indexOf("What's new (changelog)"));
    });

    it('renders the three pickers, Sheet page first, checked and labelled Recommended', () => {
      render(<DizajnPage />);
      for (const [group, options] of [
        ['Layout', TABS_LAYOUTS],
        ['Staff', TABS_STAFF],
        ['Scroll', TABS_SCROLL],
      ] as const) {
        const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
        expect(radios.map((r) => r.textContent)).toEqual(
          options.map((o) => o.name + ('badge' in o && o.badge ? o.badge : '')),
        );
        radios.forEach((r, i) => expect(r).toHaveAttribute('aria-checked', i === 0 ? 'true' : 'false'));
      }
      expect(TABS_LAYOUTS.map((o) => o.name)).toEqual(['Sheet page', 'Side panel', 'Stage']);
      expect(screen.getByRole('radio', { name: /Sheet page/ })).toHaveTextContent('Recommended');
      expect(TABS_STAFF.map((o) => o.name)).toEqual(['Tab', 'Tab + Score']);
      expect(TABS_SCROLL.map((o) => o.name)).toEqual(['Vertical', 'Horizontal']);
    });

    it('draws the Sheet page in the shell, desktop and phone, with a real AlphaTab score', async () => {
      render(<DizajnPage />);
      expect(within(section()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      expect(within(section()).getAllByTestId('tabs-layout-sheet')).toHaveLength(2);
      expect(within(section()).getAllByTestId('tabs-toolbar')).toHaveLength(2);

      await waitFor(() => expect(scores().every((s) => s.dataset.status === 'ready')).toBe(true));
      expect(live()).toHaveLength(2);
      for (const api of live()) {
        expect(api.texArgs).toEqual({ tex: SAMPLE_TEX, tracks: [0] });
        expect(api.settings.core).toMatchObject({ engine: 'svg', fontDirectory: '/alphatab/font/', useWorkers: false });
        expect(api.settings.display).toMatchObject({ staveProfile: 3, layoutMode: 0 });
        expect(api.settings.notation).toMatchObject({ rhythmMode: 2 });
        const resources = api.settings.display.resources as Record<string, string>;
        expect(resources.mainGlyphColor).toMatch(/^rgba\(/);
        expect(resources.staffLineColor).toMatch(/^rgba\(/);
      }
      // The phone draws smaller, like the planned viewer.
      expect(live().map((a) => a.settings.display.scale)).toEqual([0.95, 0.65]);
      // A cursor sits on the score.
      expect(within(section()).getAllByTestId('tab-cursor')).toHaveLength(2);
    });

    it('switching the layout changes what renders, with its description', () => {
      render(<DizajnPage />);
      pick('Layout', 'Side panel');
      expect(section().dataset.layout).toBe('side-panel');
      expect(within(section()).queryByTestId('tabs-layout-sheet')).toBeNull();
      expect(within(section()).getAllByTestId('tabs-layout-side-panel')).toHaveLength(2);
      expect(within(section()).getAllByTestId('mock-home')).toHaveLength(2);
      expect(screen.getByTestId('tabs-description').textContent).toBe(TABS_LAYOUTS[1].description);

      pick('Layout', 'Stage');
      expect(within(section()).getAllByTestId('tabs-layout-stage')).toHaveLength(2);
      expect(within(section()).queryByTestId('tabs-layout-side-panel')).toBeNull();
      expect(screen.getByTestId('tabs-description').textContent).toBe(TABS_LAYOUTS[2].description);
    });

    it('Staff and Scroll redraw the score with the matching AlphaTab settings', async () => {
      render(<DizajnPage />);
      await waitFor(() => expect(live()).toHaveLength(2));

      pick('Staff', 'Tab + Score');
      await waitFor(() => expect(live().map((a) => a.settings.display.staveProfile)).toEqual([1, 1]));
      expect(scores().map((s) => s.dataset.staff)).toEqual(['score-tab', 'score-tab']);

      pick('Scroll', 'Horizontal');
      await waitFor(() => expect(live().map((a) => a.settings.display.layoutMode)).toEqual([1, 1]));
      expect(scores().map((s) => s.dataset.scroll)).toEqual(['horizontal', 'horizontal']);
      // Every earlier drawing was torn down, not left behind.
      const mine = alphaTab.apis.filter((a) => a.destroyed || section().contains(a.host));
      expect(mine.filter((a) => a.destroyed).length).toBe(mine.length - 2);
    });

    it('the toolbar moves the pickers and switches tracks; practice controls only toggle their look', async () => {
      render(<DizajnPage />);
      const toolbar = within(section()).getAllByTestId('tabs-toolbar')[0];

      fireEvent.click(within(toolbar).getByRole('button', { name: 'Tab + Score' }));
      expect(screen.getByRole('radio', { name: 'Tab + Score' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Horizontal' }));
      expect(screen.getByRole('radio', { name: 'Horizontal' })).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(within(toolbar).getByRole('button', { name: /Bass/ }));
      await waitFor(() => expect(live().map((a) => a.texArgs?.tracks)).toEqual([[1], [1]]));
      expect(within(section()).getAllByText(/Bass, Drop D/).length).toBeGreaterThan(0);

      const built = alphaTab.apis.length;
      const loop = within(toolbar).getByRole('button', { name: 'Loop' });
      expect(loop).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(loop);
      expect(loop).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Faster' }));
      expect(within(toolbar).getByText('110%')).toBeInTheDocument();
      expect(alphaTab.apis.length).toBe(built);
    });

    it('opens the desktop shell full screen and closes it with Escape', () => {
      render(<DizajnPage />);
      fireEvent.click(within(section()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen tabs preview' });
      expect(within(overlay).getByTestId('tabs-layout-sheet')).toBeInTheDocument();
      expect(within(overlay).getByTestId('shell-preview')).toHaveAttribute('data-phone', 'false');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('tabs-fullscreen')).not.toBeInTheDocument();
    });

    it('persists all three choices to localStorage and restores them on mount', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Layout', 'Stage');
      pick('Staff', 'Tab + Score');
      pick('Scroll', 'Horizontal');

      await waitFor(() => expect(window.localStorage.getItem('dizajn-tabs-layout')).toBe('stage'));
      expect(window.localStorage.getItem('dizajn-tabs-staff')).toBe('score-tab');
      expect(window.localStorage.getItem('dizajn-tabs-scroll')).toBe('horizontal');
      unmount();

      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Stage' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Tab + Score' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Horizontal' })).toHaveAttribute('aria-checked', 'true');
      expect(section().dataset).toMatchObject({ layout: 'stage', staff: 'score-tab', scroll: 'horizontal' });
    });

    it('ignores a stale saved value', () => {
      window.localStorage.setItem('dizajn-tabs-layout', 'floating-window');
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: /Sheet page/ })).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('Paste a text tab (Guitar tabs)', () => {
    const pick = (name: string | RegExp) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Paste' })).getByRole('radio', { name }));
    const paste = () => screen.getByTestId('paste-section');
    const pasteApis = () => alphaTab.apis.filter((a) => !a.destroyed && paste().contains(a.host));

    it('offers Paste dialog (Recommended, checked) and Inline editor', () => {
      render(<DizajnPage />);
      const radios = within(screen.getByRole('radiogroup', { name: 'Paste' })).getAllByRole('radio');
      expect(TABS_PASTE.map((o) => o.name)).toEqual(['Paste dialog', 'Inline editor']);
      expect(radios.map((r) => r.textContent)).toEqual(['Paste dialogRecommended', 'Inline editor']);
      expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(screen.getByTestId('paste-description').textContent).toBe(TABS_PASTE[0].description);
    });

    it('A: the dialog over the empty tab page, desktop and phone, with the real parser and a real score', async () => {
      render(<DizajnPage />);
      expect(within(paste()).getAllByTestId('shell-preview').map((s) => s.dataset.phone)).toEqual(['false', 'true']);
      expect(within(paste()).getAllByTestId('paste-layout-dialog')).toHaveLength(2);
      expect(within(paste()).getAllByRole('dialog', { name: 'Paste a text tab' })).toHaveLength(2);
      // Behind it: the empty state with the search chips and Paste a tab.
      expect(within(paste()).getAllByRole('button', { name: 'Paste a tab' })).toHaveLength(2);
      expect(within(paste()).getAllByRole('link', { name: 'Ultimate Guitar' })[0]).toHaveAttribute(
        'href',
        'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky',
      );

      const boxes = within(paste()).getAllByRole('textbox', { name: 'Text tab' });
      expect((boxes[0] as HTMLTextAreaElement).value).toBe(PASTE_SAMPLE_TEXT);
      for (const r of within(paste()).getAllByTestId('paste-report')) {
        expect(r).toHaveTextContent('6 strings, Drop D, 9 bars, 114 notes, 4 lines skipped');
      }
      // Fit to song length is the default: 9 bars in 22.5 s is 96 bpm.
      for (const t of within(paste()).getAllByTestId('paste-tempo')) {
        expect(within(t).getByRole('button', { name: 'Fit to song length' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(t).getByRole('spinbutton', { name: 'Beats per minute' })).toHaveValue(96);
      }
      await waitFor(() => expect(pasteApis()).toHaveLength(2));
      for (const api of pasteApis()) {
        expect(api.texArgs?.tex).toContain('\\tuning (E4 B3 G3 D3 A2 D2)');
        expect(api.texArgs?.tex).toContain('\\tempo 96');
        expect(api.texArgs?.tex).toContain('\\section "Chorus"');
      }
      expect(within(paste()).getAllByRole('button', { name: 'Save' }).every((b) => !b.hasAttribute('disabled'))).toBe(true);
    });

    it('editing the text re-parses: junk is refused and Save turns off', async () => {
      render(<DizajnPage />);
      const box = within(paste()).getAllByRole('textbox', { name: 'Text tab' })[0];
      fireEvent.change(box, { target: { value: 'just some lyrics\nC G Am F' } });
      await waitFor(() => expect(within(paste()).getAllByTestId('paste-report')[0]).toHaveTextContent(/No tab lines found/));
      expect(within(paste()).getAllByRole('button', { name: 'Save' })[0]).toBeDisabled();
      expect(within(paste()).getAllByTestId('paste-preview')[0]).toHaveTextContent(/Nothing to draw yet/);
    });

    it('a typed tempo, or tapping along, redraws the score at that tempo', async () => {
      render(<DizajnPage />);
      const tempo = () => within(paste()).getAllByTestId('paste-tempo')[0];
      fireEvent.change(within(tempo()).getByRole('spinbutton', { name: 'Beats per minute' }), { target: { value: '80' } });
      await waitFor(() => expect(pasteApis().every((a) => a.texArgs?.tex.includes('\\tempo 80'))).toBe(true));

      let now = 0;
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 500));
      for (let i = 0; i < 4; i++) fireEvent.click(within(tempo()).getByRole('button', { name: /Tap along/ }));
      clock.mockRestore();
      await waitFor(() => expect(pasteApis().every((a) => a.texArgs?.tex.includes('\\tempo 120'))).toBe(true));
      expect(within(tempo()).getByRole('button', { name: /Tap along/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('B: the inline editor on the tab page, desktop and phone, with Save in the sticky toolbar', async () => {
      render(<DizajnPage />);
      pick('Inline editor');
      expect(paste().dataset.option).toBe('inline');
      expect(within(paste()).queryByTestId('paste-layout-dialog')).toBeNull();
      expect(within(paste()).getAllByTestId('paste-layout-inline')).toHaveLength(2);
      expect(within(paste()).getAllByTestId('tab-sheet-header')).toHaveLength(2);
      expect(screen.getByTestId('paste-description').textContent).toBe(TABS_PASTE[1].description);
      await waitFor(() => expect(pasteApis()).toHaveLength(2));
    });

    it('opens full screen, closes with Escape, and remembers the choice', async () => {
      const { unmount } = render(<DizajnPage />);
      pick('Inline editor');
      fireEvent.click(within(paste()).getByRole('button', { name: 'View full screen' }));
      const overlay = screen.getByRole('dialog', { name: 'Full screen paste preview' });
      expect(within(overlay).getByTestId('paste-layout-inline')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('paste-fullscreen')).not.toBeInTheDocument();
      await waitFor(() => expect(window.localStorage.getItem('dizajn-tabs-paste')).toBe('inline'));
      unmount();
      render(<DizajnPage />);
      expect(screen.getByRole('radio', { name: 'Inline editor' })).toHaveAttribute('aria-checked', 'true');
    });
  });
});
