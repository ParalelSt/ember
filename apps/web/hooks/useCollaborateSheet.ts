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

/** Composes the share sheet's data and actions (the sheet itself is
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

  /** Copy `link`, or failing that (plain http on a LAN address, or the
   *  click's permission spent on a network round trip) the old way, or
   *  failing that point at the box the link sits in. */
  const copy = async (link: string, done: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(done);
      return;
    } catch {
      // Not a secure context: the old way.
    }
    if (legacyCopy(link)) toast.success(done);
    else toast.message('Copy the link from the box');
  };

  /** Sharing is the switch the sheet no longer shows: adding someone or
   *  making a link turns it on first. */
  const shareFirst = async () => {
    if (!state?.collaborative) await actions.setCollaborative.mutateAsync(true);
  };

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
    onShareLink: async () => {
      const wasShared = !!state?.collaborative;
      let code = state?.inviteCode ?? null;
      try {
        await shareFirst();
        if (!code) code = (await actions.newInvite.mutateAsync()).inviteCode;
      } catch (e) {
        fail('Couldn’t make a link')(e);
        return;
      }
      await copy(inviteUrl(window.location.origin, code), wasShared ? 'Invite link copied' : 'Sharing is on. Invite link copied');
    },
    onStopSharing: () =>
      actions.setCollaborative.mutate(false, {
        onSuccess: () => toast.success('Sharing is off'),
        onError: fail('Couldn’t stop sharing'),
      }),
    onAdd: async (p) => {
      try {
        await shareFirst();
        await actions.addMember.mutateAsync(p.id);
        toast.success(`Added ${p.name}`);
      } catch (e) {
        fail('Couldn’t add them')(e);
      }
    },
    onRemove: (p) =>
      actions.removeMember.mutate(p.id, {
        onSuccess: (res) =>
          toast.success(res.inviteCode ? `Removed ${p.name}. The invite link was replaced, so the old one no longer works.` : `Removed ${p.name}`),
        onError: fail('Couldn’t remove them'),
      }),
    onNewLink: () =>
      actions.newInvite.mutate(undefined, {
        onSuccess: () => toast.success('New link made. The old one no longer works.'),
        onError: fail('Couldn’t make a link'),
      }),
    onStopLink: () =>
      actions.stopInvite.mutate(undefined, {
        onSuccess: () => toast.success('Invite link turned off'),
        onError: fail('Couldn’t turn it off'),
      }),
    onCopyLink: async () => {
      if (inviteLink) await copy(inviteLink, 'Invite link copied');
    },
  };
}
