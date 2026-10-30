'use client';

import { AddToPlaylistMenu } from '@/components/track/menus/AddToPlaylistMenu';
import { ArtistIcon, CloseIcon, QueueIcon } from '@/components/icons';
import type { MenuAction } from '@/components/ui/action-sheet';
import { isUnavailable } from '@/lib/playback/queueNav';
import type { Track } from '@/types/track';

/** A Next up row's ⋯ menu (owner's pick "A. Handle and ⋯"): Play next,
 *  Remove from queue, Add to playlist, Go to artist. The app's track menu:
 *  a dropdown on desktop, a sheet from the bottom on a phone, with Add to
 *  playlist opening its own list there. */
export function QueueRowMenu({
  track,
  isNext,
  onPlayNext,
  onRemove,
  onGoToArtist,
}: {
  track: Track;
  /** Already right after the song playing: no Play next. */
  isNext: boolean;
  onPlayNext: () => void;
  onRemove: () => void;
  /** Leaves the queue for the artist's page (the sheet closes first). */
  onGoToArtist: (href: string) => void;
}) {
  const artistId = track.artistId;
  const actions: MenuAction[] = [
    ...(!isNext ? [{ key: 'play-next', label: 'Play next', icon: QueueIcon, onSelect: onPlayNext }] : []),
    { key: 'remove', label: 'Remove from queue', icon: CloseIcon, onSelect: onRemove },
    ...(artistId
      ? [{ key: 'artist', label: 'Go to artist', icon: ArtistIcon, onSelect: () => onGoToArtist(`/artist/${encodeURIComponent(artistId)}`) }]
      : []),
  ];
  // The compact row plays on any click that reaches it, and React sends the
  // menu's portals there too: a tap on the phone sheet's backdrop or in the
  // new playlist dialog must not start the song.
  return (
    <div className="contents" data-testid="queue-row-menu" onClick={(e) => e.stopPropagation()}>
      <AddToPlaylistMenu
        track={track}
        actions={actions}
        allowAdd={!isUnavailable(track)}
        triggerClassName="text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent size-hit md:size-8"
      />
    </div>
  );
}
