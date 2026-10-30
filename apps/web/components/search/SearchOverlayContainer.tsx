'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SearchNoResults } from '@/components/search/SearchNoResults';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { TrackMenu, renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { MusicIcon } from '@/components/icons';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { useSearchShortcut } from '@/hooks/useSearchShortcut';
import { useBackDismiss } from '@/lib/useBackDismiss';
import { useUiStore } from '@/stores/useUiStore';

const RECENTS_FALLBACK = <MusicIcon className="h-4 w-4" />;
const STATION_SEARCH = 'Search stations';
const NOOP = () => {};

/** The data-aware half of the search overlay: owns the open flag (shell
 *  state, not the URL: opening it is instant, even with no network) and
 *  composes the shared search hook into the props SearchOverlay renders.
 *  Mounted once at the top of the content column in app/(app)/layout.tsx:
 *  on a desktop window that is where its search box lives, in the page,
 *  above everything the page itself draws. It is also what decides which
 *  chrome the overlay wears, so SearchOverlay itself stays presentational. */
export function SearchOverlayContainer({ leading }: { leading?: ReactNode } = {}) {
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
  // On /radio the same box searches stations (the owner's ask: one search
  // box, not a second one under the page title). It types the Radio page's
  // query and opens no song panel; leaving the page brings songs back.
  const stations = isDesktop && pathname === '/radio';
  const radioQuery = useUiStore((s) => s.radioQuery);
  const setRadioQuery = useUiStore((s) => s.setRadioQuery);

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

  // On /search the page's own box is the search: "/" and the sidebar's
  // Search link (which only raise the flag) put the caret there instead of
  // opening a panel that stands down here.
  useEffect(() => {
    if (!hidden || !open) return;
    close();
    document.querySelector<HTMLInputElement>('input[data-search-page-box]')?.focus();
  }, [hidden, open, close]);

  // On /radio, "/" and the sidebar's Search link put the caret in the
  // station box, with no song panel under it.
  useEffect(() => {
    if (!stations || !open) return;
    close();
    document.querySelector<HTMLInputElement>(`input[aria-label="${STATION_SEARCH}"]`)?.focus();
  }, [stations, open, close]);

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
    searchFailed,
    onPlay,
  } = useSearchQuery();

  // The phone sheet is the voice UI there: closing it (Back, the arrow, a
  // navigation) ends any listening. Otherwise the mic stays on behind the
  // closed sheet, still typing into the box and firing searches; and once
  // text arrives the sheet swaps the mic for the clear button, so there is
  // no stop control left. The desktop box stays on the page, so the panel
  // closing leaves its mic alone.
  const cancelVoice = voice.cancel;
  useEffect(() => {
    if (!open && !isDesktop) cancelVoice();
  }, [open, isDesktop, cancelVoice]);

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
            trailing={
              <TrackMenu
                track={t}
                onRemove={() => removeRecentTrack.mutate(t.id)}
                removeLabel="Remove from recent searches"
              />
            }
          />
        ))}
      </div>
    </div>
  ) : null;

  const resultsNode = !data?.length ? (
    <SearchNoResults query={debouncedQ} />
  ) : (
    <TrackList
      tracks={data}
      context={{ type: 'search', query: debouncedQ }}
      trailing={renderTrackMenu}
      trailingPlayControl
      {...trackActions}
      onPlay={onPlay}
    />
  );

  if (hidden) return null;

  if (stations) {
    return (
      <SearchOverlay
        open={false}
        onClose={close}
        onOpen={NOOP}
        variant="dropdown"
        q={radioQuery}
        onQChange={setRadioQuery}
        debouncedQ=""
        micListening={false}
        isOnline={isOnline}
        isFetching={false}
        rateLimited={false}
        hasResults={false}
        recentsNode={null}
        resultsNode={null}
        placeholder={STATION_SEARCH}
        label={STATION_SEARCH}
        leading={leading}
      />
    );
  }

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
      searchFailed={searchFailed}
      hasResults={!!data?.length}
      recentsNode={recentsNode}
      resultsNode={resultsNode}
      leading={leading}
    />
  );
}
