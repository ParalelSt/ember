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
import { cn } from '@/lib/utils';

export interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
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
 *  react-query imports — everything it renders comes from props built by
 *  SearchOverlayContainer. Lives in the app shell (app/(app)/layout.tsx) so
 *  opening it needs no route change and no network: this component itself
 *  never fetches anything.
 *
 *  Styling is provisional (per the brief) — one component, tokens not
 *  literals, matching components/ui/dialog.tsx and the bug report / request
 *  dialogs, so it's easy to restyle later. */
export function SearchOverlay({
  open,
  onClose,
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

  // Own Escape handling rather than relying only on the dialog primitive's
  // default: it keeps the behavior explicit and testable, and matches the
  // back-gesture and close-button paths, which are also ours.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl top-8 translate-y-0 sm:top-8 max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Visually hidden: base-ui requires a title for a11y, the search
            icon + input already say what this is. */}
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="relative shrink-0">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="What do you want to listen to?"
            className="pl-11 pr-20 h-12 rounded-full bg-card border-0"
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
              'absolute right-10 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full',
              micListening
                ? 'text-ember hover:text-ember animate-pulse'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MicIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close search"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4">
          {!debouncedQ && recentsNode}

          <SectionHeader
            title={debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
            className="mt-6 mb-4"
          />
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
