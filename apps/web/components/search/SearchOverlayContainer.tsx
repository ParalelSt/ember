'use client';

import { useCallback } from 'react';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { MusicIcon } from '@/components/icons';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { useSearchShortcut } from '@/hooks/useSearchShortcut';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useUiStore } from '@/stores/useUiStore';

const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;

/** The data-aware half of the search overlay: owns the open flag (shell
 *  state, not the URL — opening it is instant, even with no network) and
 *  composes the shared search hook into the props SearchOverlay renders.
 *  Mounted once in app/(app)/layout.tsx, alongside the rest of the
 *  already-loaded shell. */
export function SearchOverlayContainer() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useSearchShortcut(useCallback(() => setOpen(true), [setOpen]));
  useBackDismiss(open, close);

  const {
    q,
    setQ,
    debouncedQ,
    isOnline,
    trackActions,
    recentTracks,
    removeRecentTrack,
    voice,
    onMicClick,
    data,
    isFetching,
    rateLimited,
    onPlay,
  } = useSearchQuery();

  const recentsNode = recentTracks.length > 0 ? (
    <div className="mb-2">
      <SectionHeader title="Recent searches" className="mb-3" />
      <div className="flex flex-col">
        {recentTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
            artworkFallback={RECENTS_FALLBACK}
            artworkSrc={trackActions.artworkSrcFor(t)}
            onPlay={() => trackActions.onPlay(t)}
            onRemove={() => removeRecentTrack.mutate(t.id)}
            removeLabel={`Remove "${t.title}" from recent searches`}
          />
        ))}
      </div>
    </div>
  ) : null;

  const resultsNode = (
    <TrackList
      tracks={data ?? []}
      context={{ type: 'search', query: debouncedQ }}
      trailing={renderTrackMenu}
      {...trackActions}
      onPlay={onPlay}
    />
  );

  return (
    <SearchOverlay
      open={open}
      onClose={close}
      q={q}
      onQChange={setQ}
      debouncedQ={debouncedQ}
      onMicClick={onMicClick}
      micListening={voice.listening}
      isOnline={isOnline}
      isFetching={isFetching}
      rateLimited={rateLimited}
      hasResults={!!data?.length}
      recentsNode={recentsNode}
      resultsNode={resultsNode}
    />
  );
}
