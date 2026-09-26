'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EditIcon, LogOutIcon, MoreIcon, PeopleIcon, TrashIcon } from '@/components/icons';
import type { PlaylistRole } from '@/types/track';

export interface PlaylistMenuProps {
  role: PlaylistRole;
  onCollaborate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLeave: () => void;
}

/** Presentational only: the playlist's own "…" menu in its action bar. The
 *  owner gets Collaborate, Rename and Delete; a member of someone else's
 *  collaborative playlist only gets Leave (and Collaborate, to see who
 *  else is on it). */
export function PlaylistMenu({ role, onCollaborate, onRename, onDelete, onLeave }: PlaylistMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="playlist-menu"
        aria-label="Playlist options"
        className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground"
      >
        <MoreIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuItem data-testid="menu-collaborate" onClick={onCollaborate}>
          <PeopleIcon /> {role === 'owner' ? 'Collaborate' : 'Who can edit'}
        </DropdownMenuItem>
        {role === 'owner' ? (
          <>
            <DropdownMenuItem data-testid="menu-rename" onClick={onRename}>
              <EditIcon /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="menu-delete" variant="destructive" onClick={onDelete}>
              <TrashIcon /> Delete playlist
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="menu-leave" variant="destructive" onClick={onLeave}>
              <LogOutIcon /> Leave playlist
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
