'use client';

import { toast } from 'sonner';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { canShare, shareTrack } from '../ShareButton';
import { QueueIcon, RefreshIcon, ShareIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { addToQueue } from '@/lib/playback/addToQueue';
import { isUnavailable } from '@/lib/playback/queueNav';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

/** Row actions share one More menu, including imported-track re-matching. */
export function TrackMenu({ track, onRematch }: { track: Track; onRematch?: () => void }) {
  const { playTrack } = usePlayer();

  const queue = () => {
    const next = addToQueue(usePlayerStore.getState(), track);
    // Nothing loaded: there is no queue to add to, so the song just plays.
    if (!next) return playTrack(track, [track]);
    usePlayerStore.setState(next);
    toast.success(`Added "${track.title}" to the queue`);
  };

  return (
    <AddToPlaylistMenu
      allowAdd={!isUnavailable(track)}
      track={track}
      more={
        <>
          {!isUnavailable(track) && <DropdownMenuItem onClick={queue}>
            <QueueIcon className="h-3.5 w-3.5" /> Add to queue
          </DropdownMenuItem>}
          {canShare(track) && <DropdownMenuItem onClick={() => { void shareTrack(track); }}>
            <ShareIcon className="h-3.5 w-3.5" /> Share
          </DropdownMenuItem>}
          {onRematch && (
            <DropdownMenuItem onClick={onRematch}>
              <RefreshIcon className="h-3.5 w-3.5" /> Wrong song? Re-match
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
        </>
      }
    />
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
