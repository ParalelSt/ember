'use client';

import { toast } from 'sonner';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { canShare, shareTrack } from '../ShareButton';
import { BlockIcon, CloseIcon, QueueIcon, RefreshIcon, ShareIcon, TrashIcon } from '@/components/icons';
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
/** How a row's own Remove sits in the menu (recent searches; /dizajn R1-R4):
 *  R1 last action, plain with an X; R2 last action, red with a bin; R3 first
 *  action, plain with an X; R4 apart at the very end, red with a bin. */
export type RemoveStyle = 'R1' | 'R2' | 'R3' | 'R4';
export const DEFAULT_REMOVE_STYLE: RemoveStyle = 'R1';

export function TrackMenu({
  track,
  onRematch,
  onRemove,
  removeLabel = 'Remove',
  removeStyle = DEFAULT_REMOVE_STYLE,
  triggerClassName,
}: {
  track: Track;
  onRematch?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  removeStyle?: RemoveStyle;
  /** The More button's look, where it is not a row's (the song page). */
  triggerClassName?: string;
}) {
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

  const red = removeStyle === 'R2' || removeStyle === 'R4';
  const remove: MenuAction | null = onRemove
    ? { key: 'remove', label: removeLabel, icon: red ? TrashIcon : CloseIcon, onSelect: onRemove, destructive: red }
    : null;
  const actions: MenuAction[] = [
    ...(remove && removeStyle === 'R3' ? [remove] : []),
    ...(!isUnavailable(track) ? [{ key: 'queue', label: 'Add to queue', icon: QueueIcon, onSelect: queue }] : []),
    ...(canShare(track) ? [{ key: 'share', label: 'Share', icon: ShareIcon, onSelect: () => void shareTrack(track) }] : []),
    ...(onRematch ? [{ key: 'rematch', label: 'Wrong song? Re-match', icon: RefreshIcon, onSelect: onRematch }] : []),
    ...(user ? [{ key: 'block', label: blocked ? 'Unblock song' : 'Block song', icon: BlockIcon, onSelect: toggleBlock }] : []),
    ...(remove && (removeStyle === 'R1' || removeStyle === 'R2') ? [remove] : []),
  ];

  return (
    <AddToPlaylistMenu
      allowAdd={!isUnavailable(track)}
      track={track}
      actions={actions}
      footer={remove && removeStyle === 'R4' ? remove : undefined}
      triggerClassName={triggerClassName}
    />
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
