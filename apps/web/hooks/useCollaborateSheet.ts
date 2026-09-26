'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { legacyCopy } from '@/components/track/ShareButton';
import type { CollaborateSheetData } from '@/components/library/CollaborateSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useQueryPlaylistCollab, useQueryPlaylistPeople, usePlaylistCollabActions } from '@/hooks/usePlaylistCollab';
import { inviteUrl } from '@/lib/collab';

const fail = (what: string) => (e: unknown) => toast.error(`${what}: ${(e as Error).message}`);

/** Composes the Collaborate sheet's data and actions (the sheet itself is
 *  presentational): fetches while `open`, the people list only once the
 *  owner opens the picker. */
export function useCollaborateSheet(playlistId: string, open: boolean): CollaborateSheetData {
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const collab = useQueryPlaylistCollab(playlistId, open);
  const state = collab.data;
  const [picking, setPicking] = useState(false);
  // Every open starts with the picker closed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicking(false);
  }
  const people = useQueryPlaylistPeople(playlistId, open && picking && state?.role === 'owner');
  const actions = usePlaylistCollabActions(playlistId);

  const inviteLink =
    state?.inviteCode && typeof window !== 'undefined' ? inviteUrl(window.location.origin, state.inviteCode) : null;

  return {
    side: isDesktop ? 'right' : 'bottom',
    state,
    error: collab.error ? (collab.error as Error).message : null,
    meId: user?.id ?? null,
    inviteLink,
    people: people.data,
    peopleLoading: people.isLoading,
    picking,
    onPickingChange: setPicking,
    busy: actions.busy,
    onToggle: (on) =>
      actions.setCollaborative.mutate(on, {
        onSuccess: (s) => toast.success(s.collaborative ? 'Collaboration is on' : 'Collaboration is off'),
        onError: fail('Couldn’t change that'),
      }),
    onAdd: (p) =>
      actions.addMember.mutate(p.id, { onSuccess: () => toast.success(`Added ${p.name}`), onError: fail('Couldn’t add them') }),
    onRemove: (p) =>
      actions.removeMember.mutate(p.id, {
        onSuccess: (res) =>
          toast.success(res.inviteCode ? `Removed ${p.name}. The invite link was replaced, so the old one no longer works.` : `Removed ${p.name}`),
        onError: fail('Couldn’t remove them'),
      }),
    onNewLink: () =>
      actions.newInvite.mutate(undefined, {
        onSuccess: () => toast.success(state?.inviteCode ? 'New link made. The old one no longer works.' : 'Invite link made'),
        onError: fail('Couldn’t make a link'),
      }),
    onStopLink: () =>
      actions.stopInvite.mutate(undefined, {
        onSuccess: () => toast.success('Invite link turned off'),
        onError: fail('Couldn’t turn it off'),
      }),
    onCopyLink: async () => {
      if (!inviteLink) return;
      try {
        await navigator.clipboard.writeText(inviteLink);
        toast.success('Invite link copied');
        return;
      } catch {
        // Not a secure context (plain http on a LAN address): the old way.
      }
      if (legacyCopy(inviteLink)) toast.success('Invite link copied');
      else toast.message('Copy the link from the box');
    },
  };
}
