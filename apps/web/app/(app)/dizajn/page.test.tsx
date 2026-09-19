import type { ComponentProps, PropsWithChildren } from 'react';
import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DizajnPage from './page';
import { SHELF_OPTIONS } from '@/components/library/options';
import { SPACING_SCALE } from '@/lib/spacing';
import { MOCK_LIKED_TRACKS, MOCK_TAB_SOURCES } from './mock';
import { CHANGELOG_PLACEMENTS, CHANGELOG_STATES, BADGE_STYLES } from '@/components/library/options/changelog';
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

describe('DizajnPage', () => {
  it('renders every section with no network', () => {
    render(<DizajnPage />);

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
      expect(within(v3()).queryByTestId('v3-source-sheet')).toBeNull();
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
      const sheets = within(v3()).getAllByTestId('v3-source-sheet');
      expect(sheets).toHaveLength(2);
      expect(sheets[0].tagName).toBe('ASIDE');
      const cards = within(sheets[1]).getAllByTestId('v3-sheet-card');
      expect(cards).toHaveLength(MOCK_TAB_SOURCES.length);
      expect(cards[0]).toHaveAttribute('aria-checked', 'true');
      expect(cards[1]).toHaveTextContent('4.8 from 1,204 votes');
      expect(cards[2]).toHaveTextContent('Lead Guitar (Fender Jaguar, fuzz)');
      expect(screen.getByTestId('tabs-v3-description').textContent).toBe(TABS_V3_PICKER[1].description);

      fireEvent.click(within(sheets[0]).getByRole('button', { name: 'Close the tab list' }));
      expect(within(v3()).queryByTestId('v3-source-sheet')).toBeNull();
      fireEvent.click(within(v3()).getAllByTestId('v3-source-trigger')[1]);
      expect(within(v3()).getAllByTestId('v3-source-sheet')).toHaveLength(2);
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

    it('is the first section on the page', () => {
      render(<DizajnPage />);
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings[0]).toBe('Guitar tabs');
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
