'use client';

import { useState, useMemo, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TrashIcon, PlusIcon } from '@/components/icons';
import {
  useExecuteAddAdminInvite,
  useExecuteDeleteAdminInvite,
  useQueryAdminInvites,
} from '@/hooks/useAdmin';
import type { AdminInvite } from '@/lib/api';

export default function AdminInvitesPage() {
  const { data: invites = [], isLoading } = useQueryAdminInvites();
  const addInvite = useExecuteAddAdminInvite();
  const deleteInvite = useExecuteDeleteAdminInvite();

  const [newEmail, setNewEmail] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminInvite | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invites;
    return invites.filter((i) => i.email.toLowerCase().includes(q));
  }, [invites, search]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    try {
      await addInvite.mutateAsync(email);
      toast.success(`Added ${email}`);
      setNewEmail('');
    } catch (err) {
      toast.error(`Couldn't add: ${(err as Error).message}`);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-xl font-bold tracking-tight">Invites · {invites.length}</h2>
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <form onSubmit={onAdd} className="flex gap-2 mb-6">
        <Input
          type="email"
          placeholder="email@example.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={addInvite.isPending || !newEmail.trim()}
          className="bg-ember hover:bg-ember-soft text-white"
        >
          <PlusIcon className="h-4 w-4" />
          Add
        </Button>
      </form>

      {isLoading && <div className="text-muted-foreground py-12 text-center">Loading…</div>}
      {!isLoading && filtered.length === 0 && (
        <div className="text-muted-foreground py-12 text-center">
          {search ? 'No invites match.' : 'No invites yet — add one above.'}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((inv) => (
          <div
            key={inv.id}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center px-3 py-2 rounded-lg bg-card"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{inv.email}</div>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {new Date(inv.created).toLocaleDateString()}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPendingDelete(inv)}
              title="Remove from invite list"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Remove ${pendingDelete.email}?` : ''}
        description="They won't be able to register a new account after this. Any existing account they already created stays signed in until they sign out."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteInvite.mutateAsync(pendingDelete.id);
            toast.success(`Removed ${pendingDelete.email}`);
            setPendingDelete(null);
          } catch (e) {
            toast.error(`Couldn't remove: ${(e as Error).message}`);
            throw e;
          }
        }}
      />
    </section>
  );
}
