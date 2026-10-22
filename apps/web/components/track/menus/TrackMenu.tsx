'use client';

import { toast } from 'sonner';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { canShare, shareTrack } from '../ShareButton';
import { BlockIcon, QueueIcon, RefreshIcon, ShareIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useBlockedTracks } from '@/hooks/useBlockedTracks';
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
  const { user } = useAuth();
  const { isBlocked, block, unblock } = useBlockedTracks();
  const blocked = isBlocked(track);

  // Blocked: never in radio, mixes or recommendations again (owner request
  // 2026-10-22). The song still plays when picked by hand.
  const toggleBlock = () => {
    if (blocked) {
      void unblock(track).then(() => toast.success(`Unblocked "${track.title}"`));
      return;
    }
    void block(track).then(() =>
      toast.success(`Blocked "${track.title}". It won't come up in radio, mixes or suggestions.`, {
        action: { label: 'Undo', onClick: () => void unblock(track) },
      }),
    );
  };

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
    ...(user ? [{ key: 'block', label: blocked ? 'Unblock song' : 'Block song', icon: BlockIcon, onSelect: toggleBlock }] : []),
  ];

  return <AddToPlaylistMenu allowAdd={!isUnavailable(track)} track={track} actions={actions} />;
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
