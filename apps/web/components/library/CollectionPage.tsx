import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { ShuffleIcon } from '@/components/icons';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ActionBar } from '@/components/page/ActionBar';
import { DownloadButton, type DownloadButtonProps } from '@/components/library/DownloadButton';
import type { CollectionCoverProps } from '@/components/library/CollectionCover';
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
  emptyMessage: string;
  children?: ReactNode;
  // When true (no tracks and offline), Play/Shuffle can't do anything useful, so hide them.
  hideActions?: boolean;
}

/** Presentational only: the header, action bar and track list shared by
 *  every collection page. Play/shuffle/download logic lives in the hooks
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
  emptyMessage,
  children,
  hideActions,
}: CollectionPageProps) {
  return (
    <div>
      <CollectionHeader
        eyebrow={eyebrow}
        title={title}
        meta={meta}
        cover={cover}
        onCoverClick={onCoverClick}
        coverLabel={coverLabel}
        coverBusy={coverBusy}
      >
        <ActionBar>
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
        </ActionBar>
      </CollectionHeader>
      {tracks.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <TrackList tracks={tracks} context={context} onRemove={onRemoveTrack} />
      )}
      {children}
    </div>
  );
}
