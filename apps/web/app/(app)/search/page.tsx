'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrackRow } from '@/components/track/TrackRow';
import { TrackMenu, renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { SearchResults } from '@/components/search/SearchResults';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { CloseIcon, MicIcon, MusicIcon, SearchIcon } from '@/components/icons';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { OnlineOnly } from '@/components/OnlineOnly';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/page/EmptyState';
import { SearchNoResults } from '@/components/search/SearchNoResults';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cameBySwipe } from '@/lib/tabSwipe';
import dynamic from 'next/dynamic';
import { useScrollMemory } from '@/hooks/useScrollMemory';
import { uiSwitch } from '@/components/providers/uiSwitch';

const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;

function NewSearchPage() {
  const fieldRef = useRef<HTMLDivElement>(null);
  // A swipe from another tab shows Search without the keyboard; tapping
  // the Search tab still focuses the box.
  const [focusBox] = useState(() => !cameBySwipe());
  // The overlay's Enter key lands here with the query as ?q=; it is the
  // initial value, so the page opens already searching.
  const initialQ = useSearchParams()?.get('q') ?? '';
  const router = useRouter();
  const {
    q,
    setQ,
    debouncedQ,
    trackActions,
    recentTracks,
    removeRecentTrack,
    voice,
    onMicClick,
    view,
    hasResults,
    isFetching,
    rateLimited,
    searchFailed,
    onPlay,
  } = useSearchQuery(initialQ);
  // Enter in the phone sheet while already here changes ?q= without a remount:
  // follow it.
  const lastQ = useRef(initialQ);
  useEffect(() => {
    if (initialQ === lastQ.current) return;
    lastQ.current = initialQ;
    setQ(initialQ);
  }, [initialQ, setQ]);
  // The other way round: the typed (debounced) query is kept in the URL, by
  // replace so typing adds no history entries, so Back from a song lands on
  // this search again. lastQ is set first so the effect above does not read
  // our own replace as a new ?q= and overwrite what is being typed.
  useEffect(() => {
    if (debouncedQ === lastQ.current) return;
    lastQ.current = debouncedQ;
    router.replace(debouncedQ ? `/search?q=${encodeURIComponent(debouncedQ)}` : '/search', { scroll: false });
  }, [debouncedQ, router]);
  // Back to this URL puts the scroller where it was.
  useScrollMemory(`/search?q=${encodeURIComponent(initialQ)}`);
  const isDesktop = useIsDesktop();

  const recents = !debouncedQ && recentTracks.length > 0 ? (
    <div className="mt-8 max-w-xl">
      <SectionHeader title="Recent searches" className="mb-3" />
      <div className="flex flex-col">
        {recentTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
            marqueeTitle
            // Same player as the results below, as in the overlay: the row
            // of the song playing now pauses it rather than starting over.
            active={trackActions.currentId === t.id}
            playing={trackActions.isPlaying}
            artworkFallback={RECENTS_FALLBACK}
            artworkSrc={trackActions.artworkSrcFor(t)}
            onPlay={() => trackActions.onPlay(t)}
            onToggle={trackActions.onToggle}
            trailing={
              <TrackMenu
                track={t}
                onRemove={() => removeRecentTrack.mutate(t.id)}
                removeLabel="Remove from recent searches"
              />
            }
            trailingPlayControl
          />
        ))}
      </div>
    </div>
  ) : null;

  const results = rateLimited ? (
    <EmptyState className="text-sm">Searching too fast, one moment.</EmptyState>
  ) : searchFailed && !isFetching ? (
    <EmptyState className="text-sm">{"Search isn't working right now. Try again in a moment."}</EmptyState>
  ) : isFetching && !hasResults ? (
    <EmptyState className="text-sm">Searching…</EmptyState>
  ) : debouncedQ && !hasResults ? (
    <SearchNoResults query={debouncedQ} />
  ) : (
    <SearchResults
      key={debouncedQ}
      view={view}
      platform={isDesktop ? 'desktop' : 'phone'}
      context={{ type: 'search', query: debouncedQ }}
      trailing={renderTrackMenu}
      {...trackActions}
      onPlay={onPlay}
    />
  );

  return (
    <OnlineOnly>
      <div className="pt-4 md:pt-0">
        <PageTitle className="mb-6">Search</PageTitle>
        <div ref={fieldRef} className="relative max-w-xl">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus={focusBox}
            // The overlay hands "/" and the sidebar's Search to this box.
            data-search-page-box
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What do you want to listen to?"
            aria-label="Search"
            className={cn("pl-11 h-12 rounded-full bg-card border-0", q ? "pr-22" : "pr-12")}
          />
          {q && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ('');
                fieldRef.current?.querySelector('input')?.focus();
              }}
              className="absolute right-12 top-1/2 -translate-y-1/2 active:!-translate-y-1/2 h-9 w-9 rounded-full"
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          )}
          {/* Always visible (right side of the bar): unsupported browsers get a
              pointer to Chrome instead of a hidden button. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onMicClick}
            aria-label={voice.listening ? 'Stop voice search' : 'Search by voice'}
            aria-pressed={voice.listening}
            title="Search by voice"
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full',
              voice.listening
                ? 'text-ember hover:text-ember animate-pulse'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MicIcon className="h-4 w-4" />
          </Button>
        </div>

        {recents}

        <SectionHeader
          title={debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
          className="mt-8 mb-4"
        />
        {results}
      </div>
    </OnlineOnly>
  );
}

/** The Classic look's page (docs/classic-look.md), loaded only on a
 *  device that chose it. */
const LegacySearchPage = dynamic(() => import('@legacy/app/search/page'));

export default uiSwitch(NewSearchPage, LegacySearchPage);
