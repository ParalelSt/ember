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
import { MOCK_PLAYLISTS, MOCK_RECENT_TRACKS, MOCK_RESULT_TRACKS } from './mock';

const STORAGE_KEY = 'dizajn-shelf-option';

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

  return (
    <div>
      <PageTitle className="mb-2">Design gallery</PageTitle>
      <p className="text-meta mb-10">
        What was built, and the style options for the Library page&apos;s playlist shelves. Not a real
        page in the app: no link points here.
      </p>

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
