'use client';

import { useEffect, useState } from 'react';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { TrackRow } from '@/components/track/TrackRow';
import { TrackList } from '@/components/track/TrackList';
import { SectionHeader } from '@/components/page/SectionHeader';
import { PageTitle } from '@/components/page/PageTitle';
import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';
import { MusicIcon } from '@/components/icons';
import { SHELF_OPTIONS, RHYTHM_OPTIONS, ACTIONS_OPTIONS } from '@/components/library/options';
import { RhythmPreview, rhythmLegend, type Rhythm, type ActionsPlacement } from '@/components/library/options/RhythmPreview';
import {
  CHANGELOG_PLACEMENTS,
  CHANGELOG_STATES,
  BADGE_STYLES,
  type BadgeStyle,
  type ChangelogPlacement,
  type ChangelogState,
} from '@/components/library/options/changelog';
import { ChangelogSection } from '@/components/library/options/changelog/ChangelogSection';
import { MOCK_PLAYLISTS, MOCK_RECENT_TRACKS, MOCK_RESULT_TRACKS } from './mock';

const STORAGE_KEY = 'dizajn-shelf-option';
const RHYTHM_STORAGE_KEY = 'dizajn-rhythm-option';
const ACTIONS_STORAGE_KEY = 'dizajn-actions-option';
const CHANGELOG_PLACEMENT_KEY = 'dizajn-changelog-placement';
const CHANGELOG_STATE_KEY = 'dizajn-changelog-state';
const CHANGELOG_BADGE_KEY = 'dizajn-changelog-badge';

/** Lazy-initializer read of one picker's saved id, falling back to the
 *  first option when nothing (or something stale) is stored. */
function savedChoice<T extends string>(key: string, options: { id: T }[]): T {
  if (typeof window === 'undefined') return options[0].id;
  const saved = window.localStorage.getItem(key);
  return (options.find((o) => o.id === saved)?.id ?? options[0].id) as T;
}

const PILL_ON = 'rounded-full bg-ember px-3.5 py-1.5 text-sm font-medium text-white';
const PILL_OFF = 'rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors';

/** One pill radiogroup, the same markup as the Rhythm/Actions pickers. */
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

  // Same lazy-initializer pattern as optionId above, one key per picker so
  // the two decisions (rhythm, actions placement) persist independently.
  const [rhythm, setRhythm] = useState<Rhythm>(() => {
    if (typeof window === 'undefined') return RHYTHM_OPTIONS[0].id as Rhythm;
    const saved = window.localStorage.getItem(RHYTHM_STORAGE_KEY);
    return saved && RHYTHM_OPTIONS.some((o) => o.id === saved) ? (saved as Rhythm) : (RHYTHM_OPTIONS[0].id as Rhythm);
  });
  const [actionsPlacement, setActionsPlacement] = useState<ActionsPlacement>(() => {
    if (typeof window === 'undefined') return ACTIONS_OPTIONS[0].id as ActionsPlacement;
    const saved = window.localStorage.getItem(ACTIONS_STORAGE_KEY);
    return saved && ACTIONS_OPTIONS.some((o) => o.id === saved)
      ? (saved as ActionsPlacement)
      : (ACTIONS_OPTIONS[0].id as ActionsPlacement);
  });

  useEffect(() => {
    window.localStorage.setItem(RHYTHM_STORAGE_KEY, rhythm);
  }, [rhythm]);
  useEffect(() => {
    window.localStorage.setItem(ACTIONS_STORAGE_KEY, actionsPlacement);
  }, [actionsPlacement]);

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

  return (
    <div>
      <PageTitle className="mb-2">Design gallery</PageTitle>
      <p className="text-meta mb-10">
        What was built, and the style options for the Library page&apos;s playlist shelves. Not a real
        page in the app: no link points here.
      </p>

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
        <h2 className="text-section-title mb-1">Collection page rhythm</h2>
        <p className="text-meta mb-4">
          Stage 1 candidates (docs/design-system.md section 3): a mock Liked-songs hero under two
          independent decisions, Rhythm (the gap around the action bar) and Actions (where the action
          bar sits). Both pickers apply at once, so all four real combinations are reachable. The live
          Liked page is unchanged.
        </p>

        <div className="mb-4">
          <div className="text-eyebrow mb-2">Rhythm</div>
          <div role="radiogroup" aria-label="Rhythm" className="flex flex-wrap gap-2">
            {RHYTHM_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === rhythm}
                onClick={() => setRhythm(o.id as Rhythm)}
                title={o.description}
                className={
                  o.id === rhythm
                    ? 'rounded-full bg-ember px-3.5 py-1.5 text-sm font-medium text-white'
                    : 'rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors'
                }
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-eyebrow mb-2">Actions</div>
          <div role="radiogroup" aria-label="Actions" className="flex flex-wrap gap-2">
            {ACTIONS_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === actionsPlacement}
                onClick={() => setActionsPlacement(o.id as ActionsPlacement)}
                title={o.description}
                className={
                  o.id === actionsPlacement
                    ? 'rounded-full bg-ember px-3.5 py-1.5 text-sm font-medium text-white'
                    : 'rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-card transition-colors'
                }
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>

        <p data-testid="rhythm-legend" className="text-meta mb-4">
          {rhythmLegend(rhythm)}
        </p>

        <div className="flex flex-col gap-6">
          <div>
            <div className="text-eyebrow mb-2">Phone (390px)</div>
            <div style={{ width: 390 }} className="max-w-full overflow-x-auto">
              <RhythmPreview rhythm={rhythm} actions={actionsPlacement} phone />
            </div>
          </div>
          <div>
            <div className="text-eyebrow mb-2">Desktop</div>
            <RhythmPreview rhythm={rhythm} actions={actionsPlacement} phone={false} />
          </div>
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
