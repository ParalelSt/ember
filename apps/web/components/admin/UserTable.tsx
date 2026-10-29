'use client';

import { useState } from 'react';
import { Avatar } from '@/components/primitives/Avatar';
import { EditIcon, KeyIcon, LogOutIcon, MoreIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { AdminUser } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RenameForm, type UserActions } from './UserCards';
import { pbDateLabel } from '@/lib/pocketbase/dates';

const TRIGGER = 'grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground';

/** Admin > Users as a table. Each row's ⋯ is a dropdown on desktop and a
 *  sheet from the bottom on a phone (popups1), with the user on top. */
export function UserTable({ users, actorId, ...actions }: UserActions & { users: AdminUser[]; actorId?: string }) {
  const isDesktop = useIsDesktop();
  const [renaming, setRenaming] = useState<AdminUser | null>(null);
  const [menuFor, setMenuFor] = useState<AdminUser | null>(null);
  const isSelf = menuFor !== null && menuFor.id === actorId;

  /** Closes the sheet, then runs the action (which may open a dialog). */
  const pick = (run: (u: AdminUser) => void) => () => {
    const u = menuFor;
    setMenuFor(null);
    if (u) run(u);
  };
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table aria-label="Users" className="w-full text-left text-sm">
          <thead className="bg-card text-xs text-muted-foreground">
            <tr>{['User', 'Email', 'Role', 'Joined', 'Actions'].map(label => (
              <th key={label} scope="col" className="px-row py-cluster font-medium">{label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-card/60">
                <td className="px-row py-row">
                  <div className="flex items-center gap-cluster">
                    <Avatar src={u.avatarUrl} name={u.name} email={u.email} className="size-8 shrink-0 bg-ember text-ember-foreground text-xs" />
                    <span className={cn('font-semibold', !u.name && 'text-muted-foreground')}>{u.name || 'No name'}</span>
                  </div>
                </td>
                <td className="px-row py-row text-muted-foreground">{u.email}</td>
                <td className="px-row py-row"><span className={cn('rounded-full px-cluster py-inset text-xs font-semibold', u.isAdmin ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground')}>{u.isAdmin ? 'Admin' : 'Member'}</span></td>
                <td className="px-row py-row whitespace-nowrap text-muted-foreground tabular-nums">{pbDateLabel(u.created)}</td>
                <td className="px-row py-row">
                  {isDesktop ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`Actions for ${u.email}`} className={TRIGGER}>
                        <MoreIcon className="size-5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => setRenaming(u)}><EditIcon />Rename</DropdownMenuItem>
                        <DropdownMenuItem disabled={u.id === actorId} onClick={() => actions.onToggleAdmin(u, !u.isAdmin)}><ShieldIcon />{u.isAdmin ? 'Remove admin' : 'Make admin'}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => actions.onResetPassword(u)}><KeyIcon />Reset password</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => actions.onSignOutEverywhere(u)}><LogOutIcon />Sign out everywhere</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" disabled={u.id === actorId} onClick={() => actions.onDelete(u)}><TrashIcon />Delete user</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Actions for ${u.email}`}
                      aria-haspopup="dialog"
                      className={TRIGGER}
                      onClick={() => setMenuFor(u)}
                    >
                      <MoreIcon className="size-5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isDesktop && (
        <ActionSheet
          open={menuFor !== null}
          onOpenChange={(o) => !o && setMenuFor(null)}
          title={menuFor ? `${menuFor.name || menuFor.email} actions` : 'User actions'}
          header={
            menuFor ? (
              <div className="flex min-w-0 items-center gap-row text-left">
                <Avatar
                  src={menuFor.avatarUrl}
                  name={menuFor.name}
                  email={menuFor.email}
                  className="size-10 shrink-0 bg-ember text-ember-foreground text-sm"
                />
                <div className="min-w-0">
                  <div className={cn('truncate text-base font-semibold', !menuFor.name && 'text-muted-foreground')}>
                    {menuFor.name || 'No name'}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{menuFor.email}</div>
                </div>
              </div>
            ) : undefined
          }
        >
          <ActionSheetItem icon={EditIcon} testId="user-menu-rename" onSelect={pick(setRenaming)}>Rename</ActionSheetItem>
          <ActionSheetItem
            icon={ShieldIcon}
            testId="user-menu-admin"
            disabled={isSelf}
            onSelect={pick((u) => actions.onToggleAdmin(u, !u.isAdmin))}
          >
            {menuFor?.isAdmin ? 'Remove admin' : 'Make admin'}
          </ActionSheetItem>
          <ActionSheetItem icon={KeyIcon} testId="user-menu-reset" onSelect={pick(actions.onResetPassword)}>Reset password</ActionSheetItem>
          <ActionSheetItem icon={LogOutIcon} testId="user-menu-sign-out" onSelect={pick(actions.onSignOutEverywhere)}>Sign out everywhere</ActionSheetItem>
          <ActionSheetItem
            icon={TrashIcon}
            tone="destructive"
            testId="user-menu-delete"
            disabled={isSelf}
            onSelect={pick(actions.onDelete)}
          >
            Delete user
          </ActionSheetItem>
        </ActionSheet>
      )}
      <Dialog open={renaming !== null} onOpenChange={open => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
          {renaming && <RenameForm key={renaming.id} user={renaming} onCancel={() => setRenaming(null)} onSave={name => {
            actions.onRename(renaming, name);
            setRenaming(null);
          }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
