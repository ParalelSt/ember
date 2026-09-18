import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TrackList, type TrackActions } from '@/components/track/TrackList';
import { ShuffleIcon } from '@/components/icons';
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
  children?: ReactNode;
  // When true (no tracks and offline), Play/Shuffle can't do anything useful, so hide them.
  hideActions?: boolean;
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
  children,
  hideActions,
}: CollectionPageProps) {
  // No empty action bar (offline, nothing to play or download): the header
  // would still reserve its stack gap above it.
  const hasActions = !hideActions || !!download || !!actions;
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
            {actions}
          </ActionBar>}
        </CollectionHeader>
        {tracks.length === 0 ? (
          <EmptyState>{emptyMessage}</EmptyState>
        ) : (
          <TrackList
            tracks={tracks}
            context={context}
            onRemove={onRemoveTrack}
            onReplace={onReplaceTrack}
            trailing={trailing}
            {...trackActions}
          />
        )}
      </div>
      {children}
    </div>
  );
}
