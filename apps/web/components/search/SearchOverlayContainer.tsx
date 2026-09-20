'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { MusicIcon } from '@/components/icons';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { useSearchShortcut } from '@/hooks/useSearchShortcut';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useUiStore } from '@/stores/useUiStore';

const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;

/** The data-aware half of the search overlay: owns the open flag (shell
 *  state, not the URL: opening it is instant, even with no network) and
 *  composes the shared search hook into the props SearchOverlay renders.
 *  Mounted once at the top of the content column in app/(app)/layout.tsx:
 *  on a desktop window that is where its search box lives, in the page,
 *  above everything the page itself draws. It is also what decides which
 *  chrome the overlay wears, so SearchOverlay itself stays presentational. */
export function SearchOverlayContainer() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const openNow = useCallback(() => setOpen(true), [setOpen]);
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  // /search is the search UI in its own right, with its own box: a second
  // identical box above it would be nonsense. The route stays for deep
  // links, for phones and for landing on it directly.
  const hidden = isDesktop && pathname === '/search';

  // "/" keeps its isTypingTarget guard (hooks/useSearchShortcut); what
  // changed is what it does. On a desktop window it opens the panel, which
  // puts the caret in the in-page box; on a phone it opens the sheet.
  useSearchShortcut(openNow);
  // The phone sheet covers the screen, so Back closing it is the only sane
  // gesture. The desktop panel covers nothing and is not a place you
  // navigated to, so it leaves history alone.
  useBackDismiss(open && !isDesktop, close);

  // Going somewhere else closes the panel: it hangs over one page, it is
  // not a mode you stay in.
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (!open) {
      openedAt.current = pathname;
      return;
    }
    if (pathname !== openedAt.current) close();
  }, [pathname, open, close]);

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
            trailingPlayControl
            // Same player as the results below: one source of truth for
            // which row is current and whether it is paused.
            active={trackActions.currentId === t.id}
            playing={trackActions.isPlaying}
            artworkFallback={RECENTS_FALLBACK}
            artworkSrc={trackActions.artworkSrcFor(t)}
            onPlay={() => trackActions.onPlay(t)}
            onToggle={trackActions.onToggle}
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
      trailingPlayControl
      {...trackActions}
      onPlay={onPlay}
    />
  );

  if (hidden) return null;

  return (
    <SearchOverlay
      open={open}
      onClose={close}
      onOpen={openNow}
      variant={isDesktop ? 'dropdown' : 'sheet'}
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
