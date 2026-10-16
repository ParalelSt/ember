import type { ReactNode } from 'react';
import { CollectionPage, type CollectionPlaybackHandle } from '@/components/library/CollectionPage';
import type { TrackActions } from '@/components/track/TrackList';
import type { CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { CheckIcon, ListPlusIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { PlaybackContext, Track } from '@/types/track';

export interface GeneratedListPageProps {
  eyebrow: string;
  title: string;
  meta: string[];
  cover: CollectionCoverProps;
  /** A line under the title ("Built today from Gojira, Tool, Metallica"). */
  belowTitle?: ReactNode;
  tracks: Track[];
  context: PlaybackContext;
  playback: CollectionPlaybackHandle;
  trackActions: TrackActions;
  trailing?: (track: Track) => ReactNode;
  /** Number the rows (a chart). */
  showRank?: boolean;
  emptyMessage: string;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

/** Presentational only: a list Ember made rather than you (a chart, a
 *  genre mix). The collection page's hero, Play and Shuffle and track list,
 *  plus "Save as playlist", which keeps today's songs as a playlist of
 *  yours. */
export function GeneratedListPage({ onSave, saving, saved, ...page }: GeneratedListPageProps) {
  return (
    <CollectionPage
      {...page}
      download={null}
      actions={
        <button
          type="button"
          data-testid="save-as-playlist"
          onClick={onSave}
          disabled={saving || saved || page.tracks.length === 0}
          className={cn(
            'inline-flex h-10 items-center gap-cluster rounded-full border border-border px-block text-sm font-medium transition-colors',
            'hover:bg-card disabled:opacity-60',
          )}
        >
          {saved ? <CheckIcon className="size-4" /> : <ListPlusIcon className="size-4" />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save as playlist'}
        </button>
      }
    />
  );
}
