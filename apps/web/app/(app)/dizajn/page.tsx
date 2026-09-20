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
  IMPORT_CHOICE_STYLES,
  IMPORT_REVIEW_STYLES,
  IMPORT_SOURCES,
  IMPORT_STEPS,
  type ImportChoiceStyle,
  type ImportReviewStyle,
  type ImportSourceId,
  type ImportStep,
} from '@/components/library/options/imports';
import { ImportsSection } from '@/components/library/options/imports/ImportsSection';
import {
  TRENDING_DATA,
  TRENDING_OPTIONS,
  TRENDING_VIEWS,
  type TrendingData,
  type TrendingOption,
  type TrendingView,
} from '@/components/library/options/trending';
import { TrendingSection } from '@/components/library/options/trending/TrendingSection';
import {
  ROW_CONTROLS,
  ROW_INDICATORS,
  ROW_STATES,
  type RowControl,
  type RowIndicator,
  type RowState,
} from '@/components/library/options/searchrows';
import { SearchRowsSection } from '@/components/library/options/searchrows/SearchRowsSection';
import { MOCK_LIKED_TRACKS, MOCK_PLAYLISTS, MOCK_RECENT_TRACKS, MOCK_RESULT_TRACKS } from './mock';

const STORAGE_KEY = 'dizajn-shelf-option';
const CHANGELOG_PLACEMENT_KEY = 'dizajn-changelog-placement';
const CHANGELOG_STATE_KEY = 'dizajn-changelog-state';
const CHANGELOG_BADGE_KEY = 'dizajn-changelog-badge';
const IMPORTS_STYLE_KEY = 'dizajn-imports-style';
const IMPORTS_STEP_KEY = 'dizajn-imports-step';
const IMPORTS_REVIEW_KEY = 'dizajn-imports-review';
const TRENDING_OPTION_KEY = 'dizajn-trending-option';
const TRENDING_VIEW_KEY = 'dizajn-trending-view';
const TRENDING_DATA_KEY = 'dizajn-trending-data';
const SEARCHROWS_CONTROL_KEY = 'dizajn-searchrows-control';
const SEARCHROWS_INDICATOR_KEY = 'dizajn-searchrows-indicator';
const SEARCHROWS_STATE_KEY = 'dizajn-searchrows-state';

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
  options: { id: T; name: string; description: string }[];
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

  // "Playlist import" pickers, same pattern. The pasted-link source is a
  // local toggle only, not a design choice, so it is not saved.
  const [imStyle, setImStyle] = useState<ImportChoiceStyle>(() => savedChoice(IMPORTS_STYLE_KEY, IMPORT_CHOICE_STYLES));
  const [imStep, setImStep] = useState<ImportStep>(() => savedChoice(IMPORTS_STEP_KEY, IMPORT_STEPS));
  const [imReview, setImReview] = useState<ImportReviewStyle>(() => savedChoice(IMPORTS_REVIEW_KEY, IMPORT_REVIEW_STYLES));
  const [imSource, setImSource] = useState<ImportSourceId>('spotify');
  // Bumped on every Review screen click (even the checked one), which
  // opens that review screen in the preview.
  const [imReviewRequest, setImReviewRequest] = useState(0);

  useEffect(() => {
    window.localStorage.setItem(IMPORTS_STYLE_KEY, imStyle);
  }, [imStyle]);
  useEffect(() => {
    window.localStorage.setItem(IMPORTS_STEP_KEY, imStep);
  }, [imStep]);
  useEffect(() => {
    window.localStorage.setItem(IMPORTS_REVIEW_KEY, imReview);
  }, [imReview]);

  // "Trending shelf" pickers: same pattern again.
  const [trOption, setTrOption] = useState<TrendingOption>(() => savedChoice(TRENDING_OPTION_KEY, TRENDING_OPTIONS));
  const [trView, setTrView] = useState<TrendingView>(() => savedChoice(TRENDING_VIEW_KEY, TRENDING_VIEWS));
  const [trData, setTrData] = useState<TrendingData>(() => savedChoice(TRENDING_DATA_KEY, TRENDING_DATA));

  useEffect(() => {
    window.localStorage.setItem(TRENDING_OPTION_KEY, trOption);
  }, [trOption]);
  useEffect(() => {
    window.localStorage.setItem(TRENDING_VIEW_KEY, trView);
  }, [trView]);
  useEffect(() => {
    window.localStorage.setItem(TRENDING_DATA_KEY, trData);
  }, [trData]);

  // "Search rows" pickers: same pattern again.
  const [srControl, setSrControl] = useState<RowControl>(() => savedChoice(SEARCHROWS_CONTROL_KEY, ROW_CONTROLS));
  const [srIndicator, setSrIndicator] = useState<RowIndicator>(() =>
    savedChoice(SEARCHROWS_INDICATOR_KEY, ROW_INDICATORS),
  );
  const [srState, setSrState] = useState<RowState>(() => savedChoice(SEARCHROWS_STATE_KEY, ROW_STATES));

  useEffect(() => {
    window.localStorage.setItem(SEARCHROWS_CONTROL_KEY, srControl);
  }, [srControl]);
  useEffect(() => {
    window.localStorage.setItem(SEARCHROWS_INDICATOR_KEY, srIndicator);
  }, [srIndicator]);
  useEffect(() => {
    window.localStorage.setItem(SEARCHROWS_STATE_KEY, srState);
  }, [srState]);

  return (
    <div>
      <PageTitle className="mb-2">Design gallery</PageTitle>
      <p className="text-meta mb-10">
        What was built, and the style options for the Library page&apos;s playlist shelves. Not a real
        page in the app: no link points here.
      </p>

      <section className="mb-section">
        <h2 className="text-section-title mb-inset">Search rows</h2>
        <p className="text-meta mb-block">
          Proposals, not built: a play/pause control you can actually press inside the search
          overlay&apos;s rows, and a way to tell which row is the song playing. Both the recent
          searches (the compact lines) and the results below them use the chosen pair. Controls in
          the preview work: press one and that row takes over, press it again to pause, which moves
          the Player state picker. The row itself is pressable too, since a phone has no hover to
          reveal a control with. The live overlay and TrackRow are unchanged.
        </p>
        <p className="text-meta mb-block">
          Recommended: <strong className="font-semibold text-foreground">On the art + Bars</strong>.
          The artwork is already where a row is pressed everywhere else in Ember, so it costs no new
          column and nothing shifts when the control appears; the bars then sit in that same box, which
          makes &quot;what is playing&quot; and &quot;pause it&quot; one 40px target, the thing that matters most
          on a phone, where this overlay is mostly used. Ember title and Tinted row both read well but
          say nothing about pausing, and the Leading slot buys its stability with a gutter that is empty
          on every row but one.
        </p>

        <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
          <Picker label="Control style" options={ROW_CONTROLS} value={srControl} onChange={setSrControl} />
          <Picker label="Playing indicator" options={ROW_INDICATORS} value={srIndicator} onChange={setSrIndicator} />
          {/* "Player state", not "State": the changelog section further down
              already has a picker by that name, and two radiogroups sharing a
              label would be ambiguous to a screen reader (and to a test). */}
          <Picker label="Player state" options={ROW_STATES} value={srState} onChange={setSrState} />
        </div>

        <SearchRowsSection
          control={srControl}
          indicator={srIndicator}
          state={srState}
          onStateChange={setSrState}
        />
      </section>

      <section className="mb-section">
        <h2 className="text-section-title mb-inset">Playlist import</h2>
        <p className="text-meta mb-block">
          Proposals, not built: importing a Spotify or YouTube Music playlist from inside the
          create-playlist dialog (the + next to Playlists), then the playlist filling in, then
          checking the songs the matcher was unsure of. Everything here is mock data; buttons in
          the preview work locally (Create, Review, Pick, Skip, Accept all).
        </p>

        <div className="mb-stack flex flex-col gap-block">
          <div className="flex flex-wrap gap-x-section gap-y-block">
            <Picker label="Choice style" options={IMPORT_CHOICE_STYLES} value={imStyle} onChange={setImStyle} />
            <Picker label="Step" options={IMPORT_STEPS} value={imStep} onChange={setImStep} />
          </div>
          <div className="flex flex-wrap gap-x-section gap-y-block">
            <Picker
              label="Review screen"
              options={IMPORT_REVIEW_STYLES}
              value={imReview}
              onChange={(id) => {
                setImReview(id);
                setImStep('done');
                setImReviewRequest((n) => n + 1);
              }}
            />
            <Picker label="Pasted link" options={IMPORT_SOURCES} value={imSource} onChange={setImSource} />
          </div>
        </div>

        <ImportsSection
          choiceStyle={imStyle}
          step={imStep}
          review={imReview}
          reviewRequest={imReviewRequest}
          sourceId={imSource}
          onStepChange={setImStep}
        />
      </section>

      <section className="mb-section">
        <h2 className="text-section-title">Trending shelf</h2>
        <p className="text-meta mt-inset mb-block">
          Proposals, not built: three reworks of Home&apos;s &quot;Trending right now&quot; shelf, which
          now shows YouTube Music&apos;s real daily chart in rank order. Each sits on the mock Home page
          inside the whole app shell. Show all opens the full chart as a collection page, with no new
          page in the nav; Stale shows the note used when the chart could not be refreshed. The live
          shelf is unchanged.
        </p>

        <div className="mb-stack flex flex-wrap gap-x-section gap-y-block">
          <Picker label="Shelf style" options={TRENDING_OPTIONS} value={trOption} onChange={setTrOption} />
          <Picker label="View" options={TRENDING_VIEWS} value={trView} onChange={setTrView} />
          <Picker label="Data" options={TRENDING_DATA} value={trData} onChange={setTrData} />
        </div>

        <TrendingSection option={trOption} view={trView} data={trData} onViewChange={setTrView} />
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
