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
  /** The big "Copy invite link": turns sharing on if it is off, makes a
   *  link if there is none, and copies it. */
  onShareLink: () => void;
  /** Turns sharing off (and the link with it). */
  onStopSharing: () => void;
  /** Adds someone, turning sharing on first if it is off. */
  onAdd: (person: PlaylistPerson) => void;
  onRemove: (person: PlaylistPerson) => void;
  onNewLink: () => void;
  onStopLink: () => void;
  onCopyLink: () => void;
}

export interface CollaborateSheetProps extends CollaborateSheetData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistName: string;
}

/** Presentational only: the share sheet, from the people chip under the
 *  title or the playlist menu. Link first: the owner's one big "Copy invite
 *  link" turns sharing on (there is no separate switch), then Copy link,
 *  New link and Turn off link once a link exists; "People who can edit"
 *  with Add by name under it; Stop sharing at the end. A member sees who
 *  can edit, read-only. A side sheet on a desktop window, a bottom sheet
 *  on a phone, like the other sheets. */
export function CollaborateSheet({
  open,
  onOpenChange,
  playlistName,
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
  onShareLink,
  onStopSharing,
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

  const title = isOwner || !state ? `Share "${playlistName}"` : 'Who can edit';
  const shared = !!state?.collaborative;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-testid="collab-sheet"
        className={cn(side === 'bottom' && 'max-h-[85svh] rounded-t-2xl')}
      >
        <div className="flex min-h-0 flex-col gap-stack overflow-y-auto px-block pt-block pb-stack">
          <div className="flex flex-col gap-inset pr-section">
            <SheetTitle className="text-base font-semibold break-words">{title}</SheetTitle>
            <SheetDescription>
              {isOwner || !state
                ? 'People you invite can add, remove and reorder songs. Only you can rename it, change the cover or delete it.'
                : 'Everyone here can add, remove and reorder songs. Only the owner can rename it, change the cover or delete it.'}
            </SheetDescription>
          </div>

          {error && <p className="text-sm text-muted-foreground">Couldn’t load this. {error}</p>}
          {!state && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

          {state && isOwner && (
            <section data-testid="collab-link" className="flex flex-col gap-cluster rounded-lg border border-border p-block">
              <div className="flex items-center gap-cluster text-sm font-semibold">
                <LinkIcon className="size-4 text-ember" /> Invite link
              </div>
              {inviteLink && shared ? (
                <>
                  <Input
                    readOnly
                    value={inviteLink}
                    aria-label="Invite link"
                    data-testid="collab-link-url"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button variant="ember" className="h-10 w-full" data-testid="collab-link-copy" onClick={onCopyLink}>
                    <CopyIcon /> Copy link
                  </Button>
                  <div className="flex flex-wrap gap-cluster">
                    <Button variant="ghost" size="sm" data-testid="collab-link-new" disabled={busy} onClick={onNewLink}>
                      <RefreshIcon /> New link
                    </Button>
                    <Button variant="ghost" size="sm" data-testid="collab-link-off" disabled={busy} onClick={onStopLink}>
                      Turn off link
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    New link or Turn off link stops the old one working. Removing someone also replaces it.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Send it in any chat. Whoever opens it, signed in to this server, can edit.
                  </p>
                  <Button
                    variant="ember"
                    className="h-10 w-full"
                    data-testid="collab-link-create"
                    disabled={busy}
                    onClick={onShareLink}
                  >
                    <CopyIcon /> Copy invite link
                  </Button>
                </>
              )}
            </section>
          )}

          {state && (isOwner || shared) && (
            <section data-testid="collab-people" className="flex flex-col gap-cluster">
              <div className="flex items-center justify-between gap-row">
                <h3 className="text-sm font-semibold">{isOwner ? 'People who can edit' : 'People'}</h3>
                {isOwner && !picking && state.members.length < state.maxMembers && (
                  <Button variant="ghost" size="sm" data-testid="collab-add" onClick={() => onPickingChange(true)}>
                    <AddPersonIcon /> Add by name
                  </Button>
                )}
              </div>

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
                  <div className="flex max-h-48 flex-col gap-inset overflow-y-auto">
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

              {isOwner && !shared && state.members.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Sharing is off. These people can edit again once you share it.
                </p>
              )}
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
                <p className="text-sm text-muted-foreground">{isOwner ? 'Only you so far.' : 'Nobody else yet.'}</p>
              )}
            </section>
          )}

          {isOwner && shared && (
            <div>
              <Button variant="destructive" data-testid="collab-stop-sharing" disabled={busy} onClick={onStopSharing}>
                Stop sharing
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
