'use client';

import { useState } from 'react';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditIcon, KeyIcon, LogOutIcon, MoreIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import type { AdminUser } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AdminSheet, AdminSheetItem } from './AdminSheet';

export interface UserActions {
  onRename: (user: AdminUser, name: string) => void;
  onToggleAdmin: (user: AdminUser, isAdmin: boolean) => void;
  onDelete: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onSignOutEverywhere: (user: AdminUser) => void;
}

interface Props extends UserActions {
  users: AdminUser[];
  /** The signed-in admin: can't remove their own admin or delete themselves. */
  actorId: string | undefined;
}

/** Admin > Users on a phone: one card per person (picture, name, Admin or
 *  Member, email) with a ⋯ that opens their actions in a bottom sheet. The
 *  actions are the desktop row's, wired to the same handlers. */
export function UserCards({ users, actorId, ...actions }: Props) {
  const [menuFor, setMenuFor] = useState<AdminUser | null>(null);
  const [renaming, setRenaming] = useState<AdminUser | null>(null);
  const isSelf = menuFor?.id === actorId;

  /** Closes the menu, then runs the action (which may open a dialog). */
  const pick = (run: (u: AdminUser) => void) => () => {
    const u = menuFor;
    setMenuFor(null);
    if (u) run(u);
  };

  return (
    <>
      <ul aria-label="Users" className="flex flex-col gap-cluster">
        {users.map((u) => (
          <li key={u.id} data-testid="user-card" className="flex min-w-0 items-center gap-row rounded-xl bg-card p-row">
            <Avatar
              src={u.avatarUrl}
              name={u.name}
              email={u.email}
              className="size-10 shrink-0 bg-ember text-ember-foreground text-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-cluster">
                <span className={cn('truncate font-semibold', !u.name && 'text-muted-foreground')}>
                  {u.name || 'No name'}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-cluster text-[10px] font-bold uppercase tracking-wider',
                    u.isAdmin ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {u.isAdmin ? 'Admin' : 'Member'}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            </div>
            <button
              type="button"
              aria-label={`Actions for ${u.email}`}
              onClick={() => setMenuFor(u)}
              className="grid size-hit shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <MoreIcon className="size-5" />
            </button>
          </li>
        ))}
      </ul>

      <AdminSheet
        open={menuFor !== null}
        onOpenChange={(o) => !o && setMenuFor(null)}
        title={menuFor ? menuFor.name || menuFor.email : ''}
        data-testid="user-menu-sheet"
      >
        <div className="flex flex-col">
          <AdminSheetItem icon={EditIcon} onClick={pick(setRenaming)}>Rename</AdminSheetItem>
          <AdminSheetItem
            icon={ShieldIcon}
            disabled={isSelf}
            title={isSelf ? "Can't demote yourself" : undefined}
            onClick={pick((u) => actions.onToggleAdmin(u, !u.isAdmin))}
          >
            {menuFor?.isAdmin ? 'Remove admin' : 'Make admin'}
          </AdminSheetItem>
          <AdminSheetItem icon={KeyIcon} onClick={pick(actions.onResetPassword)}>Reset password</AdminSheetItem>
          <AdminSheetItem icon={LogOutIcon} onClick={pick(actions.onSignOutEverywhere)}>Sign out everywhere</AdminSheetItem>
          <AdminSheetItem
            icon={TrashIcon}
            destructive
            disabled={isSelf}
            title={isSelf ? "Can't delete yourself" : undefined}
            onClick={pick(actions.onDelete)}
          >
            Delete user
          </AdminSheetItem>
        </div>
      </AdminSheet>

      <AdminSheet
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename"
        data-testid="user-rename-sheet"
      >
        {renaming && (
          <RenameForm
            key={renaming.id}
            user={renaming}
            onCancel={() => setRenaming(null)}
            onSave={(name) => {
              actions.onRename(renaming, name);
              setRenaming(null);
            }}
          />
        )}
      </AdminSheet>
    </>
  );
}

export function RenameForm({ user, onSave, onCancel }: { user: AdminUser; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(user.name);
  const next = name.trim();
  return (
    <form
      className="flex flex-col gap-block"
      onSubmit={(e) => {
        e.preventDefault();
        if (next === (user.name ?? '')) onCancel();
        else onSave(next);
      }}
    >
      <div className="flex flex-col gap-cluster">
        <Label htmlFor="admin-rename">Display name for {user.email}</Label>
        <Input
          id="admin-rename"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          maxLength={50}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-cluster">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="ember" className="h-11">Save</Button>
      </div>
    </form>
  );
}
