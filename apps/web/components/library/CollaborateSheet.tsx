'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/primitives/Avatar';
import { AddPersonIcon, CloseIcon, CopyIcon, LinkIcon, RefreshIcon } from '@/components/icons';
import type { CandidatePerson, CollabState } from '@/lib/collab';
import { cn } from '@/lib/utils';
import type { PlaylistPerson } from '@/types/track';

/** Everything the sheet shows and does; hooks/useCollaborateSheet builds it. */
export interface CollaborateSheetData {
  side: 'right' | 'bottom';
  state: CollabState | undefined;
  error: string | null;
  meId: string | null;
  /** The whole invite URL (the owner's, while the link is on), else null. */
  inviteLink: string | null;
  /** Everyone the owner could add; undefined until the picker asked. */
  people: CandidatePerson[] | undefined;
  peopleLoading: boolean;
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onAdd: (person: PlaylistPerson) => void;
  onRemove: (person: PlaylistPerson) => void;
  onNewLink: () => void;
  onStopLink: () => void;
  onCopyLink: () => void;
}

export interface CollaborateSheetProps extends CollaborateSheetData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Presentational only: the Collaborate sheet, from the playlist menu. The
 *  owner turns collaboration on and off, adds people by name, removes them,
 *  and makes, copies, replaces or turns off the invite link. A member sees
 *  who else can edit, read-only. A side sheet on a desktop window, a
 *  bottom sheet on a phone, like the other sheets. */
export function CollaborateSheet({
  open,
  onOpenChange,
  side,
  state,
  error,
  meId,
  inviteLink,
  people,
  peopleLoading,
  picking,
  onPickingChange,
  busy,
  onToggle,
  onAdd,
  onRemove,
  onNewLink,
  onStopLink,
  onCopyLink,
}: CollaborateSheetProps) {
  const isOwner = state?.role === 'owner';
  const [query, setQuery] = useState('');
  // A fresh picker starts with an empty search.
  const [wasPicking, setWasPicking] = useState(picking);
  if (picking !== wasPicking) {
    setWasPicking(picking);
    if (picking) setQuery('');
  }

  const memberIds = useMemo(() => new Set(state?.members.map((m) => m.id) ?? []), [state?.members]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter(
      (p) => !memberIds.has(p.id) && (!q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)),
    );
  }, [people, memberIds, query]);

  const title = isOwner || !state ? 'Collaborate' : 'Who can edit';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-testid="collab-sheet"
        className={cn(side === 'bottom' && 'max-h-[85svh] rounded-t-2xl')}
      >
        <div className="flex min-h-0 flex-col gap-stack overflow-y-auto px-block pt-block pb-stack">
          <div className="flex flex-col gap-inset pr-section">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription>
              {isOwner || !state
                ? 'People you add can add, remove and reorder songs. Only you can rename it, change the cover or delete it.'
                : 'Everyone here can add, remove and reorder songs. Only the owner can rename it, change the cover or delete it.'}
            </SheetDescription>
          </div>

          {error && <p className="text-sm text-muted-foreground">Couldn’t load this. {error}</p>}
          {!state && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

          {state && isOwner && <SwitchRow on={state.collaborative} busy={busy} onToggle={() => onToggle(!state.collaborative)} />}

          {state?.collaborative && (
            <section data-testid="collab-people" className="flex flex-col gap-cluster">
              <div className="flex items-center justify-between gap-row">
                <h3 className="text-sm font-semibold">People</h3>
                {isOwner && !picking && state.members.length < state.maxMembers && (
                  <Button variant="ghost" size="sm" data-testid="collab-add" onClick={() => onPickingChange(true)}>
                    <AddPersonIcon /> Add people
                  </Button>
                )}
              </div>
              <PersonRow person={state.owner} you={state.owner.id === meId} tag="Owner" />
              {state.members.map((m) => (
                <PersonRow
                  key={m.id}
                  person={m}
                  you={m.id === meId}
                  onRemove={isOwner ? () => onRemove(m) : undefined}
                  busy={busy}
                />
              ))}
              {state.members.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {isOwner ? 'Nobody yet. Add people, or send them the invite link.' : 'Nobody else yet.'}
                </p>
              )}

              {isOwner && picking && (
                <div data-testid="collab-picker" className="flex flex-col gap-cluster rounded-lg border border-border p-cluster">
                  <div className="flex items-center gap-cluster">
                    <Input
                      autoFocus
                      aria-label="Find someone by name"
                      placeholder="Find someone by name"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label="Close the picker" onClick={() => onPickingChange(false)}>
                      <CloseIcon />
                    </Button>
                  </div>
                  <div className="flex max-h-60 flex-col gap-inset overflow-y-auto">
                    {peopleLoading && <p className="px-cluster text-sm text-muted-foreground">Loading…</p>}
                    {people && candidates.length === 0 && (
                      <p className="px-cluster text-sm text-muted-foreground">
                        {query ? 'Nobody by that name.' : 'Everyone on this server is already here.'}
                      </p>
                    )}
                    {candidates.map((p) => (
                      <CandidateRow key={p.id} person={p} busy={busy} onAdd={() => onAdd(p)} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {state?.collaborative && isOwner && (
            <section data-testid="collab-link" className="flex flex-col gap-cluster">
              <h3 className="text-sm font-semibold">Invite link</h3>
              <p className="text-xs text-muted-foreground">
                Anyone signed in to this server who opens it is added. Turn it off or make a new one to stop the old link working.
                Removing someone also replaces it.
              </p>
              {inviteLink ? (
                <>
                  <Input
                    readOnly
                    value={inviteLink}
                    aria-label="Invite link"
                    data-testid="collab-link-url"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="flex flex-wrap gap-cluster">
                    <Button variant="ember" size="sm" data-testid="collab-link-copy" onClick={onCopyLink}>
                      <CopyIcon /> Copy link
                    </Button>
                    <Button variant="ghost" size="sm" data-testid="collab-link-new" disabled={busy} onClick={onNewLink}>
                      <RefreshIcon /> New link
                    </Button>
                    <Button variant="ghost" size="sm" data-testid="collab-link-off" disabled={busy} onClick={onStopLink}>
                      Turn off
                    </Button>
                  </div>
                </>
              ) : (
                <div>
                  <Button variant="outline" size="sm" data-testid="collab-link-create" disabled={busy} onClick={onNewLink}>
                    <LinkIcon /> Create invite link
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SwitchRow({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-row rounded-lg border border-border px-row py-cluster">
      <div className="min-w-0">
        <div className="text-sm font-medium">Collaborative</div>
        <div className="text-xs text-muted-foreground">
          {on ? 'People you add can edit the songs.' : 'Only you can change this playlist.'}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Collaborative"
        data-testid="collab-switch"
        disabled={busy}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span className={cn('block size-4 rounded-full bg-background transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  );
}

function PersonLine({ person, children, sub }: { person: PlaylistPerson; children?: ReactNode; sub?: string }) {
  return (
    <div className="flex min-h-10 items-center gap-row">
      <Avatar src={person.avatarUrl} name={person.name} className="size-8 bg-ember text-xs text-ember-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{person.name}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function PersonRow({
  person,
  you,
  tag,
  onRemove,
  busy,
}: {
  person: PlaylistPerson;
  you: boolean;
  tag?: string;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const sub = [tag, you ? 'You' : null].filter(Boolean).join(' · ');
  return (
    <div data-testid="collab-person">
      <PersonLine person={person} sub={sub || undefined}>
        {onRemove && (
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${person.name}`} disabled={busy} onClick={onRemove}>
            <CloseIcon />
          </Button>
        )}
      </PersonLine>
    </div>
  );
}

function CandidateRow({ person, busy, onAdd }: { person: CandidatePerson; busy: boolean; onAdd: () => void }) {
  return (
    <div data-testid="collab-candidate" className="rounded-md px-cluster hover:bg-card">
      <PersonLine person={person} sub={person.email || undefined}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onAdd} aria-label={`Add ${person.name}`}>
          Add
        </Button>
      </PersonLine>
    </div>
  );
}
