'use client';

import { Fragment, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { EditIcon, LogOutIcon, MoreIcon, PeopleIcon, TrashIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { PlaylistRole } from '@/types/track';
import { ACTION_CIRCLE } from '@/components/page/ActionBar';

export interface PlaylistMenuProps {
  role: PlaylistRole;
  /** Shown on top of the phone sheet. */
  name?: string;
  onCollaborate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLeave: () => void;
}

/** Presentational only: the playlist's own "…" menu in its action bar. The
 *  owner gets Collaborate, Rename and Delete; a member of someone else's
 *  collaborative playlist only gets Leave (and Collaborate, to see who
 *  else is on it). A dropdown on desktop, a sheet from the bottom on a
 *  phone (owner's popups1 pick). */
export function PlaylistMenu({ role, name, onCollaborate, onRename, onDelete, onLeave }: PlaylistMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const actions: MenuAction[] = [
    { key: 'collaborate', label: role === 'owner' ? 'Collaborate' : 'Who can edit', icon: PeopleIcon, onSelect: onCollaborate },
    ...(role === 'owner'
      ? [
          { key: 'rename', label: 'Rename', icon: EditIcon, onSelect: onRename },
          { key: 'delete', label: 'Delete playlist', icon: TrashIcon, onSelect: onDelete, destructive: true },
        ]
      : [{ key: 'leave', label: 'Leave playlist', icon: LogOutIcon, onSelect: onLeave, destructive: true }]),
  ];

  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          data-testid="playlist-menu"
          aria-label="Playlist options"
          aria-haspopup="dialog"
          className={ACTION_CIRCLE}
          onClick={() => setOpen(true)}
        >
          <MoreIcon className="size-5" />
        </button>
        <ActionSheet
          open={open}
          onOpenChange={setOpen}
          title={name ? `${name} options` : 'Playlist options'}
          header={name ? <div className="truncate text-left text-base font-semibold">{name}</div> : undefined}
        >
          {actions.map((a) => (
            <ActionSheetItem
              key={a.key}
              icon={a.icon}
              tone={a.destructive ? 'destructive' : undefined}
              testId={`menu-${a.key}`}
              onSelect={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </ActionSheetItem>
          ))}
        </ActionSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="playlist-menu" aria-label="Playlist options" className={ACTION_CIRCLE}>
        <MoreIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {actions.map((a, i) => (
          <Fragment key={a.key}>
            {/* The destructive one sits under a line. */}
            {a.destructive && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              data-testid={`menu-${a.key}`}
              variant={a.destructive ? 'destructive' : undefined}
              onClick={a.onSelect}
            >
              <a.icon /> {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
