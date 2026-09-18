'use client';

import { useEffect, useState } from 'react';
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
  TABS_SCROLL,
  TABS_STAFF,
  type TabsLayout,
  type TabsScroll,
  type TabsStaff,
} from '@/components/library/options/tabs';
import { TabsSection } from '@/components/library/options/tabs/TabsSection';
import { MOCK_LIKED_TRACKS, MOCK_PLAYLISTS, MOCK_RECENT_TRACKS, MOCK_RESULT_TRACKS } from './mock';

const STORAGE_KEY = 'dizajn-shelf-option';
const CHANGELOG_PLACEMENT_KEY = 'dizajn-changelog-placement';
const CHANGELOG_STATE_KEY = 'dizajn-changelog-state';
const CHANGELOG_BADGE_KEY = 'dizajn-changelog-badge';
const TABS_LAYOUT_KEY = 'dizajn-tabs-layout';
const TABS_STAFF_KEY = 'dizajn-tabs-staff';
const TABS_SCROLL_KEY = 'dizajn-tabs-scroll';

/** Lazy-initializer read of one picker's saved id, falling back to the
 *  first option when nothing (or something stale) is stored. */
function savedChoice<T extends string>(key: string, options: { id: T }[]): T {
  if (typeof window === 'undefined') return options[0].id;
  const saved = window.localStorage.getItem(key);
  return (options.find((o) => o.id === saved)?.id ?? options[0].id) as T;
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
  // Lazy initializer, not a post-mount effect: this page is never
  // server-rendered with meaningful content for a signed-out visitor (the
  // app layout gates it), and reading synchronously here avoids a second
  // render just to apply the saved choice.
  const [optionId, setOptionId] = useState(() => {
    if (typeof window === 'undefined') return SHELF_OPTIONS[0].id;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved && SHELF_OPTIONS.some((o) => o.id === saved) ? saved : SHELF_OPTIONS[0].id;
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, optionId);
  }, [optionId]);

  const selected = SHELF_OPTIONS.find((o) => o.id === optionId) ?? SHELF_OPTIONS[0];

  // "What's new" pickers: same lazy-initializer pattern, one key each.
  const [clPlacement, setClPlacement] = useState<ChangelogPlacement>(() =>
    savedChoice(CHANGELOG_PLACEMENT_KEY, CHANGELOG_PLACEMENTS),
  );
  const [clState, setClState] = useState<ChangelogState>(() => savedChoice(CHANGELOG_STATE_KEY, CHANGELOG_STATES));
  const [clBadge, setClBadge] = useState<BadgeStyle>(() => savedChoice(CHANGELOG_BADGE_KEY, BADGE_STYLES));

  useEffect(() => {
    window.localStorage.setItem(CHANGELOG_PLACEMENT_KEY, clPlacement);
  }, [clPlacement]);
  useEffect(() => {
    window.localStorage.setItem(CHANGELOG_STATE_KEY, clState);
  }, [clState]);
  useEffect(() => {
    window.localStorage.setItem(CHANGELOG_BADGE_KEY, clBadge);
  }, [clBadge]);

  // "Guitar tabs" pickers: same pattern again.
  const [tabsLayout, setTabsLayout] = useState<TabsLayout>(() => savedChoice(TABS_LAYOUT_KEY, TABS_LAYOUTS));
  const [tabsStaff, setTabsStaff] = useState<TabsStaff>(() => savedChoice(TABS_STAFF_KEY, TABS_STAFF));
  const [tabsScroll, setTabsScroll] = useState<TabsScroll>(() => savedChoice(TABS_SCROLL_KEY, TABS_SCROLL));

  useEffect(() => {
    window.localStorage.setItem(TABS_LAYOUT_KEY, tabsLayout);
  }, [tabsLayout]);
  useEffect(() => {
    window.localStorage.setItem(TABS_STAFF_KEY, tabsStaff);
  }, [tabsStaff]);
  useEffect(() => {
    window.localStorage.setItem(TABS_SCROLL_KEY, tabsScroll);
  }, [tabsScroll]);

  return (
    <div>
      <PageTitle className="mb-2">Design gallery</PageTitle>
      <p className="text-meta mb-10">
        What was built, and the style options for the Library page&apos;s playlist shelves. Not a real
        page in the app: no link points here.
      </p>

      <section className="mb-section">
        <h2 className="text-section-title">Guitar tabs</h2>
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
