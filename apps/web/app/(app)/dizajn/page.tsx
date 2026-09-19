'use client';

import { useState, useSyncExternalStore } from 'react';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { TrackRow } from '@/components/track/TrackRow';
import { TrackList } from '@/components/track/TrackList';
import { SectionHeader } from '@/components/page/SectionHeader';
import { PageTitle } from '@/components/page/PageTitle';
import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';
import { MusicIcon } from '@/components/icons';
import { SHELF_OPTIONS } from '@/components/library/options';
import { CollectionPage } from '@/components/library/CollectionPage';
import { SPACING_SCALE } from '@/lib/spacing';
import {
  CHANGELOG_PLACEMENTS,
  CHANGELOG_STATES,
  BADGE_STYLES,
  type BadgeStyle,
  type ChangelogPlacement,
  type ChangelogState,
} from '@/components/library/options/changelog';
import { ChangelogSection } from '@/components/library/options/changelog/ChangelogSection';
import {
  TABS_LAYOUTS,
  TABS_PASTE,
  TABS_SCROLL,
  TABS_STAFF,
  TABS_V3_PICKER,
  TABS_V3_STATE,
  type TabsLayout,
  type TabsPaste,
  type TabsScroll,
  type TabsStaff,
  type TabsV3Picker,
  type TabsV3State,
} from '@/components/library/options/tabs';
import { TabsSection } from '@/components/library/options/tabs/TabsSection';
import { PasteSection } from '@/components/library/options/tabs/PasteSection';
import { FoundOnlineSection } from '@/components/library/options/tabs/FoundOnlineSection';
import { MOCK_LIKED_TRACKS, MOCK_PLAYLISTS, MOCK_RECENT_TRACKS, MOCK_RESULT_TRACKS } from './mock';

const STORAGE_KEY = 'dizajn-shelf-option';
const CHANGELOG_PLACEMENT_KEY = 'dizajn-changelog-placement';
const CHANGELOG_STATE_KEY = 'dizajn-changelog-state';
const CHANGELOG_BADGE_KEY = 'dizajn-changelog-badge';
const TABS_LAYOUT_KEY = 'dizajn-tabs-layout';
const TABS_STAFF_KEY = 'dizajn-tabs-staff';
const TABS_SCROLL_KEY = 'dizajn-tabs-scroll';
const TABS_PASTE_KEY = 'dizajn-tabs-paste';
const TABS_V3_PICKER_KEY = 'dizajn-tabs-v3-picker';
const TABS_V3_STATE_KEY = 'dizajn-tabs-v3-state';

// Saved picker choices. The page is server-rendered with the first option
// of every picker, so the saved one must not be read during the first
// (hydrating) render or React reports a mismatch (#418). A store read
// through useSyncExternalStore does exactly that: the server snapshot
// (nothing saved) during hydration, then the saved id straight after.
const choiceListeners = new Set<() => void>();

function subscribeChoices(listener: () => void) {
  choiceListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readChoice(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** One picker's choice, saved to localStorage under `key`, falling back to
 *  the first option when nothing (or something stale) is stored. */
function useSavedChoice<T extends string>(key: string, options: { id: T }[]): [T, (id: T) => void] {
  const saved = useSyncExternalStore(
    subscribeChoices,
    () => readChoice(key),
    () => null,
  );
  const value = options.find((o) => o.id === saved)?.id ?? options[0].id;
  const set = (id: T) => {
    try {
      window.localStorage.setItem(key, id);
    } catch {
      // Storage off (private window): the choice just is not remembered.
    }
    choiceListeners.forEach((l) => l());
  };
  return [value, set];
}

const PILL_ON = 'rounded-full bg-ember px-3.5 py-1.5 text-sm font-medium text-white';
const PILL_OFF = 'rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors';

/** One pill radiogroup, the same markup as the style option picker. */
function Picker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; name: string; description: string; badge?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <div className="text-eyebrow mb-2">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            onClick={() => onChange(o.id)}
            title={o.description}
            className={o.id === value ? PILL_ON : PILL_OFF}
          >
            {o.name}
            {o.badge && (
              <span className="ml-cluster rounded-full bg-white/20 px-cluster text-[10px] leading-4 font-semibold uppercase tracking-wide">
                {o.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

type OverlayState = 'recents' | 'searching' | 'results' | 'offline' | 'rate-limited';

const OVERLAY_STATES: { id: OverlayState; label: string }[] = [
  { id: 'recents', label: 'Empty, with recents' },
  { id: 'searching', label: 'Searching' },
  { id: 'results', label: 'Results' },
  { id: 'offline', label: 'Offline' },
  { id: 'rate-limited', label: 'Rate limited' },
];

// No hooks/stores in the SearchOverlay itself: everything it shows comes
// from these props, built per preview state rather than from a real
// search. Nothing here ever calls the network.
function overlayPropsFor(state: OverlayState) {
  const trackActions = {
    currentId: null,
    isPlaying: false,
    likedIds: new Set<string>(),
    onPlay: () => {},
    onToggle: () => {},
  };

  const recentsNode = (
    <div className="mb-2">
      <SectionHeader title="Recent searches" className="mb-3" />
      <div className="flex flex-col">
        {MOCK_RECENT_TRACKS.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
            artworkFallback={<MusicIcon className="h-4 w-4" />}
            onPlay={() => {}}
            onRemove={() => {}}
            removeLabel={`Remove "${t.title}" from recent searches`}
          />
        ))}
      </div>
    </div>
  );

  const resultsNode = (
    <TrackList tracks={MOCK_RESULT_TRACKS} context={{ type: 'search', query: 'second' }} {...trackActions} />
  );

  const base = {
    q: state === 'recents' ? '' : 'second',
    onQChange: () => {},
    debouncedQ: state === 'recents' ? '' : 'second',
    onMicClick: () => {},
    micListening: false,
    isOnline: state !== 'offline',
    isFetching: state === 'searching',
    rateLimited: state === 'rate-limited',
    hasResults: state === 'results',
    recentsNode,
    resultsNode,
  };

  return base;
}

/** /dizajn: an in-app gallery, not a real route anyone links to (no nav
 *  entry). Everything on it renders from mock data in ./mock.ts; nothing
 *  here fetches or writes anything, so it works offline and is safe to
 *  leave in the shipped app. Signed-in only via the app layout's own auth
 *  gate; this page adds no gate of its own. */
export default function DizajnPage() {
  const [overlayState, setOverlayState] = useState<OverlayState>('recents');
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Every picker below: saved to localStorage, read after hydration.
  const [optionId, setOptionId] = useSavedChoice(STORAGE_KEY, SHELF_OPTIONS);
  const selected = SHELF_OPTIONS.find((o) => o.id === optionId) ?? SHELF_OPTIONS[0];

  const [clPlacement, setClPlacement] = useSavedChoice<ChangelogPlacement>(CHANGELOG_PLACEMENT_KEY, CHANGELOG_PLACEMENTS);
  const [clState, setClState] = useSavedChoice<ChangelogState>(CHANGELOG_STATE_KEY, CHANGELOG_STATES);
  const [clBadge, setClBadge] = useSavedChoice<BadgeStyle>(CHANGELOG_BADGE_KEY, BADGE_STYLES);

  const [tabsLayout, setTabsLayout] = useSavedChoice<TabsLayout>(TABS_LAYOUT_KEY, TABS_LAYOUTS);
  const [tabsStaff, setTabsStaff] = useSavedChoice<TabsStaff>(TABS_STAFF_KEY, TABS_STAFF);
  const [tabsScroll, setTabsScroll] = useSavedChoice<TabsScroll>(TABS_SCROLL_KEY, TABS_SCROLL);
  const [tabsPaste, setTabsPaste] = useSavedChoice<TabsPaste>(TABS_PASTE_KEY, TABS_PASTE);
  const [v3Picker, setV3Picker] = useSavedChoice<TabsV3Picker>(TABS_V3_PICKER_KEY, TABS_V3_PICKER);
  const [v3State, setV3State] = useSavedChoice<TabsV3State>(TABS_V3_STATE_KEY, TABS_V3_STATE);

  return (
    <div>
      <PageTitle className="mb-2">Design gallery</PageTitle>
      <p className="text-meta mb-10">
        What was built, and the style options for the Library page&apos;s playlist shelves. Not a real
        page in the app: no link points here.
      </p>

      <section className="mb-section">
        <h2 className="text-section-title mb-block">Guitar tabs</h2>

        <div data-testid="tabs-v3-block" className="mb-section">
          <h3 className="font-semibold">Tabs v3: found online</h3>
          <p className="text-meta mt-inset mb-block">
            Preview of the planned design, not built yet (docs/tabs-v3.md). Ember looks for the song on
            Songsterr and Ultimate Guitar, draws the best match and lines it up with the recording. Two
            ways to pick between the tabs it found, and the four states the page can be in. The sources,
            ratings and votes are made up; the score is real AlphaTab drawing the bundled original riff.
            Click the source chip to open or close the picker.
          </p>
          <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
            <Picker label="Source picker" options={TABS_V3_PICKER} value={v3Picker} onChange={setV3Picker} />
            <Picker label="Page state" options={TABS_V3_STATE} value={v3State} onChange={setV3State} />
          </div>
          <FoundOnlineSection picker={v3Picker} state={v3State} />
        </div>

        <h3 className="font-semibold">Where the tab lives</h3>
        <p className="text-meta mt-inset mb-block">
          Where tabs live once they look like Songsterr (docs/tabs-rebuild.md), each inside the whole app
          shell. Sheet page is the owner&apos;s pick, with Horizontal as a toggle inside it; Side panel and
          Stage stay here to compare. The score is real: AlphaTab drawing a bundled sample riff with the
          viewer&apos;s settings. Tracks, Tab + Score and Horizontal work in the preview; speed, loop and
          count-in are wired in later stages. The live tabs dialog is unchanged.
        </p>
        <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
          <Picker label="Layout" options={TABS_LAYOUTS} value={tabsLayout} onChange={setTabsLayout} />
          <Picker label="Staff" options={TABS_STAFF} value={tabsStaff} onChange={setTabsStaff} />
          <Picker label="Scroll" options={TABS_SCROLL} value={tabsScroll} onChange={setTabsScroll} />
        </div>

        <TabsSection
          layout={tabsLayout}
          staff={tabsStaff}
          scroll={tabsScroll}
          onStaffChange={setTabsStaff}
          onScrollChange={setTabsScroll}
        />

        <h3 className="mt-section font-semibold">Paste a text tab</h3>
        <p className="text-meta mt-inset mb-block">
          Two ways to paste a tab copied from Ultimate Guitar or anywhere else (docs/tab-sources.md). The
          sample is an original riff typed the way text tabs look; it runs through the real parser and the
          preview is real AlphaTab, so edit the text and watch the score and the report follow. Tempo fits
          the song length by default, Tap along is the alternative. Save and the search chips do nothing here.
        </p>
        <div className="mb-stack">
          <Picker label="Paste" options={TABS_PASTE} value={tabsPaste} onChange={setTabsPaste} />
        </div>
        <PasteSection option={tabsPaste} />
      </section>

      <section className="mb-12">
        <h2 className="text-section-title mb-1">What&apos;s new (changelog)</h2>
        <p className="text-meta mb-4">
          Proposals, not built: where a changelog of app updates lives, shown in the whole app
          shell. An unread entry gets a New tag until it is read; the changelog itself has Mark all
          as read and a switch to never show New tags. Click the entry point in the preview to open
          it.
        </p>

        <div className="mb-6 flex flex-col gap-4">
          <Picker label="Placement" options={CHANGELOG_PLACEMENTS} value={clPlacement} onChange={setClPlacement} />
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <Picker label="State" options={CHANGELOG_STATES} value={clState} onChange={setClState} />
            <Picker label="Badge" options={BADGE_STYLES} value={clBadge} onChange={setClBadge} />
          </div>
        </div>

        <ChangelogSection placement={clPlacement} state={clState} badge={clBadge} onStateChange={setClState} />
      </section>

      <section className="mb-12">
        <h2 className="text-section-title mb-1">Instant search overlay</h2>
        <p className="text-meta mb-4">
          Built and on the instant-search branch. Open each state below to see the real
          SearchOverlay component, driven by mock data instead of a live search.
        </p>
        <div className="flex flex-wrap gap-2">
          {OVERLAY_STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOverlayState(s.id);
                setOverlayOpen(true);
              }}
              className="rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
        <SearchOverlay
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          {...overlayPropsFor(overlayState)}
        />
      </section>

      <section className="mb-12">
        <h2 className="text-section-title mb-1">Loading skeletons</h2>
        <p className="text-meta mb-4">
          CollectionSkeleton, shown by the route loading.tsx files while a page&apos;s chunk and
          data arrive. Three variants, one per page shape.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(['collection', 'album', 'artist'] as const).map((variant) => (
            <div key={variant}>
              <div className="text-eyebrow mb-2">{variant}</div>
              <div className="rounded-lg border border-border p-4">
                <CollectionSkeleton variant={variant} rows={3} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-section-title mb-1">Spacing scale</h2>
        <p className="text-meta mb-4">
          The spacing tokens in globals.css (docs/design-system.md section 2). Each ruler is drawn
          with the token&apos;s own width utility, so it is the real value, not a picture of it.
        </p>
        <div data-testid="spacing-scale" className="flex flex-col gap-cluster">
          {SPACING_SCALE.map((step) => (
            <div key={step.name} data-testid="spacing-ruler" className="flex items-center gap-row">
              <div className="w-20 shrink-0 font-mono text-sm">{step.name}</div>
              <div className="w-12 shrink-0 text-meta tabular-nums">{step.px}px</div>
              <div className="w-12 shrink-0">
                <div className={`h-3 rounded-sm bg-ember ${step.ruler}`} />
              </div>
              <div className="min-w-0 text-meta">{step.role}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-section-title mb-1">Collection page</h2>
        <p className="text-meta mb-4">
          Stage 1 is decided: Rhythm Even (24 above the action bar, 24 below it) with the actions
          Beside the cover, so there are no pickers any more. This is the real CollectionPage the
          Liked, Recent, Uploads and playlist pages render, fed mock tracks; album, artist and track
          pages share the same stack. Narrow the window below 768px for the phone layout.
        </p>
        <div className="rounded-lg border border-border p-page md:p-page-lg">
          <CollectionPage
            eyebrow="Playlist"
            title="Liked songs"
            meta={[`${MOCK_LIKED_TRACKS.length} songs`, '15 min']}
            cover={{ src: null, icon: 'heart' }}
            tracks={MOCK_LIKED_TRACKS}
            context={{ type: 'liked' }}
            playback={{ play: () => {}, shuffle: () => {}, shuffleOn: false, active: false }}
            download={{
              state: 'idle',
              onDownload: () => {},
              onCancel: () => {},
              onRemove: () => {},
              onUpdate: () => {},
            }}
            trackActions={{
              currentId: null,
              isPlaying: false,
              likedIds: new Set(MOCK_LIKED_TRACKS.map((t) => t.id)),
              onPlay: () => {},
              onToggle: () => {},
              onLike: () => {},
            }}
            emptyMessage="No liked songs yet."
          />
        </div>
      </section>

      <section>
        <h2 className="text-section-title mb-1">Library playlists, style options</h2>
        <p className="text-meta mb-4">
          Proposals, not built: four treatments of the Library page&apos;s playlist shelves, all
          rendered with the same mock playlists so they&apos;re comparable. The live Library page is
          unchanged.
        </p>

        <div role="radiogroup" aria-label="Style option" className="flex flex-wrap gap-2 mb-3">
          {SHELF_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.id === optionId}
              onClick={() => setOptionId(o.id)}
              className={
                o.id === optionId
                  ? 'rounded-full bg-ember px-3.5 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors'
              }
            >
              {o.name}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <div className="text-2xl font-bold tracking-tight">{selected.name}</div>
          <p className="text-meta mt-1">{selected.description}</p>
        </div>

        <selected.Component title="Playlists" items={MOCK_PLAYLISTS} size="md" />
      </section>
    </div>
  );
}
