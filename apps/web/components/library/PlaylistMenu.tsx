import { EditIcon, LogOutIcon, PeopleIcon, TrashIcon } from '@/components/icons';
import type { MenuAction } from '@/components/ui/action-sheet';
import type { PlaylistRole } from '@/types/track';

export interface PlaylistMenuHandlers {
  onCollaborate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLeave: () => void;
}

/** The playlist's own rows in its ⋯ menu (components/library/MoreMenu,
 *  after the collection's Copy songs to… and Edit order). The owner gets
 *  Collaborate, Rename and Delete; a member of someone else's collaborative
 *  playlist only gets Leave (and Collaborate, to see who else is on it). */
export function playlistMenuActions(role: PlaylistRole, h: PlaylistMenuHandlers): MenuAction[] {
  return [
    { key: 'collaborate', label: role === 'owner' ? 'Collaborate' : 'Who can edit', icon: PeopleIcon, onSelect: h.onCollaborate },
    ...(role === 'owner'
      ? [
          { key: 'rename', label: 'Rename', icon: EditIcon, onSelect: h.onRename },
          { key: 'delete', label: 'Delete playlist', icon: TrashIcon, onSelect: h.onDelete, destructive: true },
        ]
      : [{ key: 'leave', label: 'Leave playlist', icon: LogOutIcon, onSelect: h.onLeave, destructive: true }]),
  ];
}
