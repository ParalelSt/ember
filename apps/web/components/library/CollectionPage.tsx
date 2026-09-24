import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TrackList, type TrackActions } from '@/components/track/TrackList';
import { SelectIcon, ShuffleIcon } from '@/components/icons';
import { Checkbox } from '@/components/primitives/Checkbox';
import { SortMenu } from '@/components/track/SortMenu';
import { formatCount } from '@/lib/format';
import type { SortState } from '@/lib/playlistCopy';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ActionBar } from '@/components/page/ActionBar';
import { DownloadButton, type DownloadButtonProps } from '@/components/library/DownloadButton';
import type { CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { cn } from '@/lib/utils';
import type { PlaybackContext, Track } from '@/types/track';
import { EmptyState } from '@/components/page/EmptyState';

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
  cover: CollectionCoverProps;
  onCoverClick?: () => void;
  coverLabel?: string;
  coverBusy?: boolean;
  tracks: Track[];
  context: PlaybackContext;
  playback: CollectionPlaybackHandle;
  download: DownloadButtonProps | null;
  actions?: ReactNode;
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
  /** Between the header and the list (an import's progress or summary). */
  banner?: ReactNode;
  /** Replaces the track list (an import's rows with its placeholders). */
  list?: ReactNode;
  children?: ReactNode;
  // When true (no tracks and offline), Play/Shuffle can't do anything useful, so hide them.
  hideActions?: boolean;
  /** Number the rows 1, 2, 3 (a ranked list, like a chart). */
  showRank?: boolean;
  /** The Sort button above the list. The page sorts `tracks` itself
   *  (hooks/useCollectionSort) and hands the sorted list in. */
  sort?: { value: SortState; onChange: (sort: SortState) => void };
  /** Select mode (hooks/useTrackSelection): a Select button in the action
   *  bar, Select all above the list, tick boxes in the play column. */
  selection?: CollectionSelectionHandle;
  /** The bar that sticks to the bottom while selecting (Copy to…). */
  selectionBar?: ReactNode;
  /** "12 Jun" for a row, in select mode on a wide list. */
  addedLabel?: (track: Track) => string | undefined;
}

/** Presentational only: the header, action bar and track list shared by
 *  every collection page, laid out as one stack (docs/design-system.md
 *  section 3): the header with the action bar in its text column, then
 *  `stack` 24, then the list. Play/shuffle/download logic lives in the hooks
 *  the caller passes in (`playback`, `download`); this component just
 *  wires their output to buttons. */
export function CollectionPage({
  eyebrow,
  title,
  meta,
  cover,
  onCoverClick,
  coverLabel,
  coverBusy,
  tracks,
  context,
  playback,
  download,
  actions,
  onRemoveTrack,
  onReplaceTrack,
  trackActions,
  trailing,
  emptyMessage,
  banner,
  list,
  children,
  hideActions,
  showRank,
  sort,
  selection,
  selectionBar,
  addedLabel,
}: CollectionPageProps) {
  // No empty action bar (offline, nothing to play or download): the header
  // would still reserve its stack gap above it.
  // Select and Sort work on the plain list only: an import's own rows
  // (`list`) and an empty collection have nothing to pick.
  const canSelect = !!selection && !list && tracks.length > 0;
  const selecting = canSelect && selection.selecting;
  const hasActions = !hideActions || !!download || !!actions || canSelect;
  return (
    <div>
      <div className="flex flex-col gap-stack">
        <CollectionHeader
          eyebrow={eyebrow}
          title={title}
          meta={meta}
          cover={cover}
          onCoverClick={onCoverClick}
          coverLabel={coverLabel}
          coverBusy={coverBusy}
        >
          {hasActions && <ActionBar>
            {!hideActions && (
              <>
                <PlayButton onClick={playback.play} disabled={!tracks.length} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={playback.shuffle}
                  disabled={!tracks.length}
                  aria-pressed={playback.shuffleOn}
                  className={cn(
                    'h-12 w-12 rounded-full',
                    playback.shuffleOn ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={playback.active ? (playback.shuffleOn ? 'Shuffle off' : 'Shuffle') : 'Shuffle play'}
                  title={playback.active ? (playback.shuffleOn ? 'Shuffling' : 'Shuffle') : 'Shuffle play'}
                >
                  <ShuffleIcon className="h-5 w-5" />
                </Button>
              </>
            )}
            {download && <DownloadButton {...download} />}
            {canSelect && (
              <button
                type="button"
                data-testid="select-toggle"
                aria-pressed={selecting}
                onClick={selecting ? selection.exit : selection.enter}
                className={cn(
                  'inline-flex h-10 items-center gap-cluster rounded-full border px-block text-sm font-medium transition-colors',
                  selecting ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-card',
                )}
              >
                <SelectIcon className="size-4" />
                {selecting ? 'Done' : 'Select'}
              </button>
            )}
            {actions}
          </ActionBar>}
        </CollectionHeader>
        {banner}
        {list ?? (tracks.length === 0 ? (
          <EmptyState>{emptyMessage}</EmptyState>
        ) : (
          <div className="flex flex-col gap-cluster">
            {(sort || canSelect) && (
              <div
                data-testid="list-toolbar"
                className="flex min-h-12 items-center justify-between gap-row border-b border-border px-row pb-cluster"
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
                  <span className="text-sm text-muted-foreground">{formatCount(tracks.length, 'song')}</span>
                )}
                {sort && <SortMenu sort={sort.value} onChange={sort.onChange} />}
              </div>
            )}
            <TrackList
              tracks={tracks}
              showRank={showRank}
              context={context}
              onRemove={onRemoveTrack}
              onReplace={onReplaceTrack}
              trailing={trailing}
              selection={canSelect ? selection : undefined}
              addedLabel={addedLabel}
              {...trackActions}
            />
          </div>
        ))}
      </div>
      {canSelect && selectionBar}
      {children}
    </div>
  );
}
