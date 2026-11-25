'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TrackList, type TrackActions } from '@/components/track/TrackList';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, SearchIcon, ShuffleIcon, SortIcon } from '@/components/icons';
import { ReorderList } from '@/components/track/ReorderList';
import { Checkbox } from '@/components/primitives/Checkbox';
import { SortMenu } from '@/components/track/SortMenu';
import { MoreMenu } from '@/components/library/MoreMenu';
import type { MenuAction } from '@/components/ui/action-sheet';
import type { SortState } from '@/lib/playlistCopy';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ACTION_CIRCLE, ACTION_CIRCLE_ON, ActionBar } from '@/components/page/ActionBar';
import { DownloadButton, type DownloadButtonProps } from '@/components/library/DownloadButton';
import type { CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { cn } from '@/lib/utils';
import { filterTracks } from '@/lib/listSearch';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ListSearchBox } from '@/components/library/ListSearchBox';
import type { PlaybackContext, PlaylistPerson, Track } from '@/types/track';
import { EmptyState, type EmptyStateProps } from '@/components/page/EmptyState';

// Same shape as hooks/useCollectionPlayback's CollectionPlayback, restated
// here rather than imported: presentational components under components/
// must not depend on hooks/.
export interface CollectionPlaybackHandle {
  play: () => void;
  shuffle: () => void;
  shuffleOn: boolean;
  active: boolean;
}

// hooks/useTrackSelection's TrackSelection, restated for the same reason.
export interface CollectionSelectionHandle {
  selecting: boolean;
  enter: () => void;
  exit: () => void;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  count: number;
  total: number;
  allState: boolean | 'mixed';
}

export interface CollectionPageProps {
  eyebrow: string;
  title: string;
  meta: string[];
  /** Under the title and meta: the "Shared by" badge, the people chip. */
  belowTitle?: ReactNode;
  cover: CollectionCoverProps;
  onCoverClick?: () => void;
  coverLabel?: string;
  coverBusy?: boolean;
  tracks: Track[];
  context: PlaybackContext;
  playback: CollectionPlaybackHandle;
  download: DownloadButtonProps | null;
  /** Loose buttons after Play, Shuffle and Download (Transfer, Save as
   *  playlist). */
  actions?: ReactNode;
  /** The page's own rows in the ⋯ menu, after Copy songs to… and Edit
   *  order (a playlist's Collaborate, Rename, Delete). */
  moreActions?: MenuAction[];
  /** The ⋯ button's accessible name, and the name atop its phone sheet. */
  moreLabel?: string;
  moreName?: string;
  onRemoveTrack?: (trackId: string) => void;
  /** Opens the page's find-replacement dialog for an unavailable track.
   *  Omitted where a replacement isn't actionable (Recently played). */
  onReplaceTrack?: (track: Track) => void;
  /** Player + likes wiring for the track list. Passed in (from the page's
   *  `useTrackActions()`) so this component stays presentational. */
  trackActions: TrackActions;
  /** Per-row menu; pages pass `renderTrackMenu`. */
  trailing?: (track: Track) => ReactNode;
  emptyMessage: string;
  /** Dresses `emptyMessage` as the sentence of a full empty state: an icon,
   *  a title and the next step. Left out, it stays a plain line. */
  empty?: Pick<EmptyStateProps, 'icon' | 'title' | 'action'>;
  /** Between the header and the list (an import's progress or summary). */
  banner?: ReactNode;
  /** Replaces the track list (an import's rows with its placeholders). */
  list?: ReactNode;
  children?: ReactNode;
  // When true (no tracks and offline), Play/Shuffle can't do anything useful, so hide them.
  hideActions?: boolean;
  /** Number the rows 1, 2, 3 (a ranked list, like a chart). */
  showRank?: boolean;
  /** The Sort button, at the right end of the action bar. The page sorts
   *  `tracks` itself (hooks/useCollectionSort) and hands the sorted list
   *  in. */
  sort?: { value: SortState; onChange: (sort: SortState) => void };
  /** Select mode (hooks/useTrackSelection), entered from "Copy songs to…"
   *  in the ⋯ menu: a Done pill in the action bar, Select all above the
   *  list, tick boxes in the play column. */
  selection?: CollectionSelectionHandle;
  /** The bar that sticks to the bottom while selecting (Copy to…). */
  selectionBar?: ReactNode;
  /** "12 Jun" for a row, in select mode on a wide list. */
  addedLabel?: (track: Track) => string | undefined;
  /** Who added each song, on a collaborative playlist. */
  addedBy?: (track: Track) => PlaylistPerson | null | undefined;
  /** Edit order, for someone who can change the playlist: "Edit order" in
   *  the ⋯ menu; while `editing`, `tracks` (the page's draft order) show
   *  with arrows and drag handles, and Done above the list saves. */
  reorder?: {
    editing: boolean;
    tracks: Track[];
    onStart: () => void;
    onDone: () => void;
    onMove: (from: number, to: number) => void;
    saving?: boolean;
  };
}

const PAGE_SIZE = 50;

/** Page numbers to show: always first, last and the current one with a
 *  neighbour each side, gaps as null, so the pager fits a 390px phone. */
export function pageItems(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, page - 1, page, page + 1]);
  const nums = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/** Presentational only: the header, action bar and track list shared by
 *  every collection page: header, gutter-aligned actions, then the list. Play/shuffle/download logic lives in the hooks
 *  the caller passes in (`playback`, `download`); this component just
 *  wires their output to buttons. */
export function CollectionPage({
  eyebrow,
  title,
  meta,
  belowTitle,
  cover,
  onCoverClick,
  coverLabel,
  coverBusy,
  tracks,
  context,
  playback,
  download,
  actions,
  moreActions,
  moreLabel,
  moreName,
  onRemoveTrack,
  onReplaceTrack,
  trackActions,
  trailing,
  emptyMessage,
  empty,
  banner,
  list,
  children,
  hideActions,
  showRank,
  sort,
  selection,
  selectionBar,
  addedLabel,
  addedBy,
  reorder,
}: CollectionPageProps) {
  // No empty action bar (offline, nothing to play or download): the header
  // would still reserve its stack gap above it.
  // Select and Sort work on the plain list only: an import's own rows
  // (`list`) and an empty collection have nothing to pick.
  const editingOrder = !!reorder?.editing && !list;
  const canSelect = !!selection && !list && tracks.length > 0 && !editingOrder;
  const selecting = canSelect && selection.selecting;
  // Search in the list: plain list only (not an import's rows, not select or
  // edit-order mode, which work on the whole list).
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const canSearch = !list && tracks.length > 0 && !editingOrder && !selecting;
  const q = canSearch ? query : '';
  const filtering = q.trim() !== '';
  const shown = useMemo(() => filterTracks(tracks, q), [tracks, q]);
  // Desktop: the box is always there. Phone: the icon reveals it.
  const boxVisible = canSearch && (isDesktop || searchOpen || filtering);
  // Desktop: soft box in the action row. Phone: underline box above the songs.
  // Pages of 50 on the plain list only; edit order works on the whole list.
  const paginated = !list && !editingOrder && shown.length > PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const sortKey = sort ? JSON.stringify(sort.value) : '';
  // Back to page 1 when the list's inputs change. Compared during render so
  // the old page never paints against the new list.
  const [pageState, setPageState] = useState({ page: 1, tracks, q, sortKey });
  const stale = pageState.tracks !== tracks || pageState.q !== q || pageState.sortKey !== sortKey;
  if (stale) setPageState({ page: 1, tracks, q, sortKey });
  // Clamped: removing songs can leave the stored page past the new last one.
  const page = stale ? 1 : Math.min(pageState.page, pageCount);
  const pageTracks = useMemo(
    () => (paginated ? shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : shown),
    [paginated, shown, page],
  );
  // Only the pager's own clicks scroll: a reset from searching must not.
  const listAnchor = useRef<HTMLDivElement>(null);
  const scrollPending = useRef(false);
  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    listAnchor.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [page]);
  const goTo = (n: number) => {
    if (n === page) return;
    scrollPending.current = true;
    setPageState({ page: n, tracks, q, sortKey });
  };
  // Playing a filtered or paged row queues the whole list, starting at that
  // song. A paged list queues `shown` (what paging reaches), never the
  // 50-song slice; an unpaged search keeps queueing every track.
  const queue = paginated ? shown : tracks;
  const listActions = useMemo<TrackActions>(
    () =>
      filtering || paginated
        ? { ...trackActions, onPlay: (t, _l, c) => trackActions.onPlay(t, queue, c) }
        : trackActions,
    [filtering, paginated, trackActions, queue],
  );
  const canReorder = !!reorder && !list && tracks.length > 1 && !selecting && !filtering;
  const showSort = !!sort && !list && tracks.length > 0 && !editingOrder;
  // The ⋯ menu: the collection's own modes first, then the page's rows.
  // It steps aside while selecting, for the Done pill.
  const menu: MenuAction[] = selecting
    ? []
    : [
        ...(canSelect ? [{ key: 'copy-songs', label: 'Copy songs to…', icon: CopyIcon, onSelect: selection.enter }] : []),
        ...(canReorder && !editingOrder && reorder
          ? [{ key: 'edit-order', label: 'Edit order', icon: SortIcon, onSelect: reorder.onStart }]
          : []),
        ...(moreActions ?? []),
      ];
  const hasActions = !hideActions || canSearch || !!download || !!actions || menu.length > 0 || selecting || showSort;
  return (
    <div>
      <div className="flex flex-col gap-stack">
        <CollectionHeader
          eyebrow={eyebrow}
          title={title}
          meta={meta}
          belowTitle={belowTitle}
          cover={cover}
          onCoverClick={onCoverClick}
          coverLabel={coverLabel}
          coverBusy={coverBusy}
        />
          {hasActions && <ActionBar>
            {!hideActions && (
              <>
                <PlayButton onClick={playback.play} disabled={!tracks.length} />
                <button
                  type="button"
                  onClick={playback.shuffle}
                  disabled={!tracks.length}
                  aria-pressed={playback.active && playback.shuffleOn}
                  className={cn(ACTION_CIRCLE, playback.active && playback.shuffleOn && ACTION_CIRCLE_ON)}
                  aria-label="Shuffle play"
                  title="Shuffle play"
                >
                  <ShuffleIcon className="h-5 w-5" />
                </button>
              </>
            )}
            {download && <DownloadButton {...download} />}
            {actions}
            {selecting && (
              <button
                type="button"
                data-testid="select-toggle"
                aria-pressed
                onClick={selection.exit}
                className="inline-flex h-10 items-center gap-cluster rounded-full border border-foreground bg-foreground px-block text-sm font-medium text-background transition-colors"
              >
                <CheckIcon className="size-4" />
                Done
              </button>
            )}
            {canSearch && !isDesktop && (
              <button
                type="button"
                data-testid="list-search-toggle"
                aria-label="Search in this list"
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setQuery('');
                  setSearchOpen(!searchOpen);
                }}
                className={cn(ACTION_CIRCLE, searchOpen && ACTION_CIRCLE_ON)}
              >
                <SearchIcon className="h-5 w-5" />
              </button>
            )}
            {canSearch && isDesktop && (
              <ListSearchBox
                value={query}
                onChange={setQuery}
                variant="soft"
                className="ml-auto w-[260px]"
              />
            )}
            <MoreMenu actions={menu} label={moreLabel} name={moreName} />
            {showSort && (
              <div className={cn(!(canSearch && isDesktop) && 'ml-auto')}>
                <SortMenu sort={sort.value} onChange={sort.onChange} />
              </div>
            )}
          </ActionBar>}
        {banner}
        {list ?? (tracks.length === 0 ? (
          <EmptyState {...empty}>{emptyMessage}</EmptyState>
        ) : (
          <div className="flex flex-col gap-cluster">
            {(selecting || editingOrder) && (
              <div
                data-testid="list-toolbar"
                className="flex min-h-12 items-center justify-between gap-row border-b border-border pb-cluster"
              >
                {selecting ? (
                  <div className="flex min-w-0 items-center gap-cluster">
                    <Checkbox
                      checked={selection.allState}
                      onChange={selection.toggleAll}
                      label={selection.allState === true ? 'Clear selection' : 'Select all'}
                      testId="select-all-box"
                    />
                    <button
                      type="button"
                      data-testid="select-all"
                      onClick={selection.toggleAll}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {selection.allState === true ? 'Clear all' : 'Select all'}
                    </button>
                    <span data-testid="select-count" className="truncate text-sm text-muted-foreground">
                      {selection.count} of {selection.total}
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="truncate text-sm text-muted-foreground">Drag a song, or use the arrows</span>
                    {reorder && (
                      <button
                        type="button"
                        data-testid="edit-order"
                        disabled={reorder.saving}
                        onClick={reorder.onDone}
                        className="inline-flex h-8 shrink-0 items-center gap-inset rounded-full border border-ember bg-ember px-row text-sm font-medium text-ember-foreground transition-colors hover:bg-ember-soft disabled:opacity-50"
                      >
                        <CheckIcon className="size-4" />
                        Done
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {boxVisible && !isDesktop && (
              <ListSearchBox
                value={query}
                onChange={setQuery}
                onEscape={() => setSearchOpen(false)}
                autoFocus
              />
            )}
            {editingOrder && reorder ? (
              <ReorderList tracks={reorder.tracks} onMove={reorder.onMove} />
            ) : filtering && shown.length === 0 ? (
              <EmptyState action={{ label: 'Clear', onClick: () => setQuery('') }}>
                No songs match &ldquo;{q.trim()}&rdquo;
              </EmptyState>
            ) : (
              // Scrolls to the first row, not the page top, so the cover
              // header stays off screen; clears the sticky desktop bar.
              <div ref={listAnchor} className="flex scroll-mt-[var(--ember-topbar-h,0px)] flex-col gap-stack">
                <TrackList
                  tracks={pageTracks}
                  indexOffset={paginated ? (page - 1) * PAGE_SIZE : 0}
                  showRank={showRank}
                  context={context}
                  onRemove={onRemoveTrack}
                  onReplace={onReplaceTrack}
                  trailing={trailing}
                  selection={canSelect ? selection : undefined}
                  addedLabel={addedLabel}
                  addedBy={addedBy}
                  {...listActions}
                />
                {paginated && (
                  <nav aria-label="Pages" data-testid="pager" className="flex flex-col items-center gap-cluster pt-cluster">
                    <p data-testid="pager-range" className="text-sm text-muted-foreground">
                      Songs {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, shown.length)} of {shown.length}
                    </p>
                    <div className="flex items-center gap-inset">
                      <button
                        type="button"
                        aria-label="Previous page"
                        disabled={page === 1}
                        onClick={() => goTo(page - 1)}
                        className="inline-flex h-10 items-center gap-inset rounded-full px-row text-sm hover:bg-foreground/10 disabled:opacity-40"
                      >
                        <ChevronLeftIcon className="size-4" />
                        <span className="hidden sm:inline">Previous</span>
                      </button>
                      {pageItems(page, pageCount).map((n, i) =>
                        n === null ? (
                          <span key={`gap-${i}`} aria-hidden className="px-inset text-sm text-muted-foreground">&hellip;</span>
                        ) : (
                          <button
                            key={n}
                            type="button"
                            aria-label={`Page ${n}`}
                            aria-current={n === page ? 'page' : undefined}
                            onClick={() => goTo(n)}
                            className={cn(
                              'inline-flex h-10 min-w-10 items-center justify-center rounded-full px-inset text-sm tabular-nums hover:bg-foreground/10',
                              n === page && 'bg-foreground text-background hover:bg-foreground',
                            )}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        aria-label="Next page"
                        disabled={page === pageCount}
                        onClick={() => goTo(page + 1)}
                        className="inline-flex h-10 items-center gap-inset rounded-full px-row text-sm hover:bg-foreground/10 disabled:opacity-40"
                      >
                        <span className="hidden sm:inline">Next</span>
                        <ChevronRightIcon className="size-4" />
                      </button>
                    </div>
                  </nav>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {canSelect && selectionBar}
      {children}
    </div>
  );
}
