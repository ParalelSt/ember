'use client';

import { useState } from 'react';
import { Avatar } from '@/components/primitives/Avatar';
import { EditIcon, KeyIcon, LogOutIcon, MoreIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AdminUser } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RenameForm, type UserActions } from './UserCards';

export function UserTable({ users, actorId, ...actions }: UserActions & { users: AdminUser[]; actorId?: string }) {
  const [renaming, setRenaming] = useState<AdminUser | null>(null);
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
                <td className="px-row py-row whitespace-nowrap text-muted-foreground tabular-nums">{new Date(u.created).toLocaleDateString()}</td>
                <td className="px-row py-row">
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`Actions for ${u.email}`} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
