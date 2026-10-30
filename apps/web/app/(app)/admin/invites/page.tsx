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
import { pbDateLabel } from '@/lib/pocketbase/dates';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { Label } from '@/components/ui/label';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { AdminSheet } from '@/components/admin/AdminSheet';
import { Popup } from '@/components/ui/popup';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export default function AdminInvitesPage() {
  const { data: invites = [], isLoading, error } = useQueryAdminInvites();
  const addInvite = useExecuteAddAdminInvite();
  const deleteInvite = useExecuteDeleteAdminInvite();

  const [newEmail, setNewEmail] = useState('');
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AdminInvite | null>(null);
  // Both layouts share the email state and add action.
  const [addOpen, setAddOpen] = useState(false);
  const isDesktop = useIsDesktop();

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
      setAddOpen(false);
    } catch (err) {
      toast.error(`Couldn't add: ${(err as Error).message}`);
    }
  };

  return (
    <section className="pb-stack md:pb-0">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <SectionHeader title={`Invites · ${invites.length}`} />
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {isDesktop && <Button variant="ember" onClick={() => setAddOpen(true)}><PlusIcon className="size-4" />Add invite</Button>}
      </div>

      {!isDesktop && <form onSubmit={onAdd} className="hidden md:flex gap-2 mb-6">
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
          variant="ember"
          className="h-11"
        >
          <PlusIcon className="h-4 w-4" />
          Add
        </Button>
      </form>}

      {isLoading && <EmptyState>Loading…</EmptyState>}
      {error && <EmptyState>Couldn&apos;t load invites: {(error as Error).message}</EmptyState>}
      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState>
          {search ? 'No invites match.' : `No invites yet, add one ${isDesktop ? 'above' : 'with the + button'}.`}
        </EmptyState>
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
              {pbDateLabel(inv.created)}
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

      {isDesktop && (
        <Popup
          open={addOpen}
          onOpenChange={setAddOpen}
          className="sm:max-w-sm"
          title="Add invite"
          actionLabel="Add invite"
          actionDisabled={addInvite.isPending || !newEmail.trim()}
          onSubmit={onAdd}
        >
          <div className="flex flex-col gap-cluster">
            <Label htmlFor="desktop-invite-email">Email</Label>
            <Input id="desktop-invite-email" type="email" placeholder="email@example.com" autoFocus
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
        </Popup>
      )}

      {!isDesktop && (
        <>
          <FloatingActionButton icon={PlusIcon} aria-label="Add invite" onClick={() => setAddOpen(true)} />
          <AdminSheet open={addOpen} onOpenChange={setAddOpen} title="Add invite" data-testid="add-invite-sheet">
            <form onSubmit={onAdd} className="flex flex-col gap-block">
              <div className="flex flex-col gap-cluster">
                <Label htmlFor="add-invite-email">Email</Label>
                <Input
                  id="add-invite-email"
                  type="email"
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-cluster">
                <Button type="button" variant="outline" className="h-11" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="ember"
                  className="h-11"
                  disabled={addInvite.isPending || !newEmail.trim()}
                >
                  Add
                </Button>
              </div>
            </form>
          </AdminSheet>
        </>
      )}

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
