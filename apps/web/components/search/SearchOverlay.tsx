'use client';

import { useEffect, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CloseIcon, MicIcon, SearchIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { SearchDropdown } from '@/components/search/SearchDropdown';
import { cn } from '@/lib/utils';

/** Which chrome the same search UI wears.
 *
 *  - `dropdown`: a desktop window. A real search box in the page, at the
 *    top of the content column, with the results hanging under it.
 *    Non-modal: nothing else on screen is covered, dimmed or disabled, so
 *    the player bar, the sidebar and the page stay usable while it is open.
 *    Starting a song does NOT close it, which is the whole point.
 *  - `sheet`: a phone. Today's full-screen modal dialog, unchanged: on a
 *    phone there is nothing else on screen worth keeping reachable. */
export type SearchOverlayVariant = 'dropdown' | 'sheet';

export interface SearchOverlayProps {
  /** The results panel is showing. On `dropdown` the box itself is always
   *  in the page, open or not. */
  open: boolean;
  onClose: () => void;
  /** Focusing or typing in the in-page box opens the panel. Unused by the
   *  sheet, whose box only exists while it is already open. */
  onOpen: () => void;
  variant: SearchOverlayVariant;
  q: string;
  onQChange: (value: string) => void;
  debouncedQ: string;
  onMicClick: () => void;
  micListening: boolean;
  isOnline: boolean;
  isFetching: boolean;
  rateLimited: boolean;
  /** True once the current query has any results, so the "Searching…" line
   *  only shows before the first batch arrives, same as the page. */
  hasResults: boolean;
  /** Recent-searches block, already built by the data-aware wrapper (a list
   *  of TrackRow, presentational itself); null when there is nothing to
   *  show. */
  recentsNode: ReactNode;
  /** The TrackList for the current results, built by the wrapper. */
  resultsNode: ReactNode;
}

/** Presentational: props in, callbacks out. No hooks/, stores/ or
 *  react-query imports: everything it renders comes from props built by
 *  SearchOverlayContainer, `variant` included. Lives in the app shell
 *  (app/(app)/layout.tsx) so opening it needs no route change and no
 *  network: this component itself never fetches anything. */
export function SearchOverlay({
  open,
  onClose,
  onOpen,
  variant,
  q,
  onQChange,
  debouncedQ,
  onMicClick,
  micListening,
  isOnline,
  isFetching,
  rateLimited,
  hasResults,
  recentsNode,
  resultsNode,
}: SearchOverlayProps) {
  const showOffline = !isOnline;
  const showRateLimited = !showOffline && rateLimited;
  const showSearching = !showOffline && !showRateLimited && isFetching && !hasResults;
  const showResults = !showOffline && !showRateLimited && !showSearching;
  const isSheet = variant === 'sheet';

  // The sheet owns its Escape rather than relying only on the dialog
  // primitive's default: it keeps the behavior explicit and testable, and
  // matches the back-gesture and close-button paths, which are also ours.
  // The dropdown has its own Escape (SearchDropdown), because it also has
  // to hand focus back to wherever it came from.
  useEffect(() => {
    if (!open || !isSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isSheet, onClose]);

  const field = (
    <div className="relative shrink-0">
      <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        // The sheet's box is born with the sheet, so it takes focus on
        // mount. The dropdown's box is always in the page, so autoFocus
        // there would grab the caret on every page load; SearchDropdown
        // focuses it when the panel opens instead.
        autoFocus={isSheet}
        value={q}
        onChange={(e) => {
          onOpen();
          onQChange(e.target.value);
        }}
        onFocus={isSheet ? undefined : onOpen}
        placeholder="What do you want to listen to?"
        aria-label="Search"
        className={cn('pl-11 h-12 rounded-full bg-card border-0', isSheet ? 'pr-20' : 'pr-12')}
      />
      {/* Always visible: unsupported browsers get a pointer to Chrome
          instead of a hidden button. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onMicClick}
        aria-label={micListening ? 'Stop voice search' : 'Search by voice'}
        aria-pressed={micListening}
        title="Search by voice"
        className={cn(
          'absolute top-1/2 -translate-y-1/2 h-9 w-9 rounded-full',
          isSheet ? 'right-10' : 'right-1',
          micListening
            ? 'text-ember hover:text-ember animate-pulse'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <MicIcon className="h-4 w-4" />
      </Button>
      {/* Only the sheet gets an X. The dropdown closes by clicking away
          from it (or Escape), and an X on a panel that covers nothing is
          the clutter the picked candidate deliberately dropped. */}
      {isSheet && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close search"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  // With no query typed yet, the panel is just recents: no "Trending"
  // heading and no chart to fetch (the overlay never asked for one; the
  // Home shelf's useQueryTrending is a separate call). Offline still gets
  // its own line here, since recents are local and searching is not what
  // is blocked; a calm one-liner replaces the old empty "No tracks" list
  // when there is nothing to show at all.
  const body = !debouncedQ ? (
    recentsNode ?? (
      showOffline ? (
        <EmptyState className="text-sm">
          No connection. This will run when you are back online.
        </EmptyState>
      ) : (
        <EmptyState className="text-sm">Search for a song, artist or album</EmptyState>
      )
    )
  ) : (
    <>
      <SectionHeader title={`Results for "${debouncedQ}"`} className="mt-6 mb-4" />
      {showOffline && (
        <EmptyState className="text-sm">
          No connection. This will run when you are back online.
        </EmptyState>
      )}
      {showRateLimited && (
        <EmptyState className="text-sm">Searching too fast, one moment.</EmptyState>
      )}
      {showSearching && <EmptyState className="text-sm">Searching…</EmptyState>}
      {showResults && resultsNode}
    </>
  );

  if (!isSheet) {
    return <SearchDropdown open={open} onClose={onClose} field={field} body={body} />;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl top-8 translate-y-0 sm:top-8 max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Visually hidden: base-ui requires a title for a11y, the search
            icon + input already say what this is. */}
        <DialogTitle className="sr-only">Search</DialogTitle>
        {field}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
