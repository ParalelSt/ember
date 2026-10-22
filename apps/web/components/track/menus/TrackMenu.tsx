'use client';

import { toast } from 'sonner';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { canShare, shareTrack } from '../ShareButton';
import { QueueIcon, RefreshIcon, ShareIcon } from '@/components/icons';
import type { MenuAction } from '@/components/ui/action-sheet';
import { usePlayer } from '@/components/player/PlayerProvider';
import { addToQueue } from '@/lib/playback/addToQueue';
import { isUnavailable } from '@/lib/playback/queueNav';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

/** Row actions share one More menu, including imported-track re-matching:
 *  a dropdown on desktop, a sheet from the bottom on a phone. */
export function TrackMenu({ track, onRematch }: { track: Track; onRematch?: () => void }) {
  const { playTrack } = usePlayer();

  const queue = () => {
    const next = addToQueue(usePlayerStore.getState(), track);
    // Nothing loaded: there is no queue to add to, so the song just plays.
    if (!next) return playTrack(track, [track]);
    usePlayerStore.setState(next);
    toast.success(`Added "${track.title}" to the queue`);
  };

  const actions: MenuAction[] = [
    ...(!isUnavailable(track) ? [{ key: 'queue', label: 'Add to queue', icon: QueueIcon, onSelect: queue }] : []),
    ...(canShare(track) ? [{ key: 'share', label: 'Share', icon: ShareIcon, onSelect: () => void shareTrack(track) }] : []),
    ...(onRematch ? [{ key: 'rematch', label: 'Wrong song? Re-match', icon: RefreshIcon, onSelect: onRematch }] : []),
  ];

  return <AddToPlaylistMenu allowAdd={!isUnavailable(track)} track={track} actions={actions} />;
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
