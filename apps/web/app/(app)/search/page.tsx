'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { TrackMenu, renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { CloseIcon, MicIcon, MusicIcon, SearchIcon } from '@/components/icons';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { OnlineOnly } from '@/components/OnlineOnly';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';

const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;

export default function SearchPage() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const {
    q,
    setQ,
    debouncedQ,
    trackActions,
    recentTracks,
    removeRecentTrack,
    voice,
    onMicClick,
    data,
    isFetching,
    rateLimited,
    searchFailed,
    onPlay,
  } = useSearchQuery();

  const recents = !debouncedQ && recentTracks.length > 0 ? (
    <div className="mt-8 max-w-xl">
      <SectionHeader title="Recent searches" className="mb-3" />
      <div className="flex flex-col">
        {recentTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
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
  ) : isFetching && !data?.length ? (
    <EmptyState className="text-sm">Searching…</EmptyState>
  ) : (
    <TrackList
      tracks={data ?? []}
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
            autoFocus
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
