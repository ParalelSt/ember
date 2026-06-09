'use client';

import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PasswordResetDialog } from '@/components/ui/password-reset-dialog';
import { KeyIcon, TrashIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  useExecuteDeleteAdminUser,
  useExecuteResetAdminUserPassword,
  useExecuteUpdateAdminUser,
  useQueryAdminUsers,
} from '@/hooks/useAdmin';
import type { AdminUser } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function AdminUsersPage() {
  const { user: actor, signOut } = useAuth();
  const { data: users = [], isLoading } = useQueryAdminUsers();
  const updateUser = useExecuteUpdateAdminUser();
  const deleteUser = useExecuteDeleteAdminUser();
  const resetPassword = useExecuteResetAdminUserPassword();

  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [pendingReset, setPendingReset] = useState<AdminUser | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-bold tracking-tight">Users · {users.length}</h2>
        <Input
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading && <div className="text-muted-foreground py-12 text-center">Loading…</div>}
      {!isLoading && filtered.length === 0 && (
        <div className="text-muted-foreground py-12 text-center">No users match.</div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === actor?.id}
            onRename={(name) => updateUser.mutate(
              { id: u.id, patch: { name } },
              {
                onSuccess: () => toast.success('Saved'),
                onError: (e) => toast.error(`Couldn't save: ${(e as Error).message}`),
              },
            )}
            onToggleAdmin={(isAdmin) => updateUser.mutate(
              { id: u.id, patch: { isAdmin } },
              {
                onSuccess: () => toast.success(isAdmin ? `Promoted ${u.email}` : `Demoted ${u.email}`),
                onError: (e) => toast.error(`Couldn't update: ${(e as Error).message}`),
              },
            )}
            onDelete={() => setPendingDelete(u)}
            onResetPassword={() => setPendingReset(u)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Delete ${pendingDelete.email}?` : ''}
        description="This cascades into the user's playlists, likes, and play history. It can't be undone."
        confirmLabel="Delete user"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteUser.mutateAsync(pendingDelete.id);
            toast.success(`Deleted ${pendingDelete.email}`);
            setPendingDelete(null);
          } catch (e) {
            toast.error(`Couldn't delete: ${(e as Error).message}`);
            throw e;
          }
        }}
      />

      {/* `key` resets the dialog's internal state when the target changes —
          cleaner than a useEffect reset, satisfies set-state-in-effect rule. */}
      <PasswordResetDialog
        key={pendingReset?.id ?? 'closed'}
        open={pendingReset !== null}
        onOpenChange={(o) => !o && setPendingReset(null)}
        targetEmail={pendingReset?.email ?? ''}
        isSelfReset={pendingReset?.id === actor?.id}
        onSubmit={async (password) => {
          if (!pendingReset) return;
          const wasSelf = pendingReset.id === actor?.id;
          try {
            const result = await resetPassword.mutateAsync({ id: pendingReset.id, password });
            toast.success(`Password reset for ${pendingReset.email}`);
            if (result.selfReset || wasSelf) {
              await signOut();   // clears authStore + hard-navigates to /auth
            }
          } catch (e) {
            toast.error(`Couldn't reset password: ${(e as Error).message}`);
            throw e;   // keep dialog open
          }
        }}
      />
    </section>
  );
}

interface RowProps {
  user: AdminUser;
  isSelf: boolean;
  onRename: (name: string) => void;
  onToggleAdmin: (isAdmin: boolean) => void;
  onDelete: () => void;
  onResetPassword: () => void;
}

function UserRow({ user, isSelf, onRename, onToggleAdmin, onDelete, onResetPassword }: RowProps) {
  const [name, setName] = useState(user.name);

  const commitRename = () => {
    const next = name.trim();
    if (next === (user.name ?? '')) return;
    onRename(next);
  };

  return (
    <div className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-3 py-2 rounded-lg bg-card">
      <div className="relative h-8 w-8 rounded-full overflow-hidden bg-ember text-white grid place-items-center text-xs font-bold shrink-0">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          (user.name || user.email)[0]?.toUpperCase() ?? '?'
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{user.email}</div>
        <div className="text-xs text-muted-foreground">{new Date(user.created).toLocaleDateString()}</div>
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Display name"
        maxLength={50}
        className="h-8 text-sm"
      />
      <label
        className={cn(
          'flex items-center gap-2 text-sm px-2 select-none',
          isSelf && 'text-muted-foreground cursor-not-allowed',
        )}
        title={isSelf ? "Can't demote yourself" : ''}
      >
        <input
          type="checkbox"
          checked={user.isAdmin}
          disabled={isSelf}
          onChange={(e) => onToggleAdmin(e.target.checked)}
          className="h-4 w-4 accent-ember"
        />
        Admin
      </label>
      <Button
        variant="ghost"
        size="icon"
        onClick={onResetPassword}
        title="Reset password"
        aria-label={`Reset password for ${user.email}`}
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
      >
        <KeyIcon className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={isSelf}
        title={isSelf ? "Can't delete yourself" : 'Delete user'}
        className={cn(
          'h-8 w-8 text-muted-foreground hover:text-destructive',
          isSelf && 'opacity-30 cursor-not-allowed',
        )}
      >
        <TrashIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
