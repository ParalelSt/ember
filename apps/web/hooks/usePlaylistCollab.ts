'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import type { CollabState } from '@/lib/collab';

export const collabKey = (id: string) => ['playlist-collab', id] as const;
export const peopleKey = (id: string) => ['playlist-people', id] as const;

/** The Collaborate sheet's data: on or off, owner, members, invite code
 *  (owner only). Fetched while the sheet is open. */
export function useQueryPlaylistCollab(id: string, enabled: boolean) {
  return useQuery({ queryKey: collabKey(id), queryFn: () => api.getPlaylistCollab(id), enabled });
}

/** Everyone the owner could add, for the picker. */
export function useQueryPlaylistPeople(id: string, enabled: boolean) {
  return useQuery({
    queryKey: peopleKey(id),
    queryFn: () => api.listPlaylistPeople(id).then((r) => r.people),
    enabled,
    staleTime: 60_000,
  });
}

/** The owner's controls in the sheet, plus Leave for a member. Every one
 *  refreshes the sheet, the playlist page and the library list. */
export function usePlaylistCollabActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: collabKey(id) });
    void qc.invalidateQueries({ queryKey: QK.playlist(id) });
    void qc.invalidateQueries({ queryKey: QK.playlists });
  };
  const patchState = (patch: Partial<CollabState>) =>
    qc.setQueryData<CollabState>(collabKey(id), (prev) => (prev ? { ...prev, ...patch } : prev));

  const setCollaborative = useMutation({
    mutationFn: (on: boolean) => api.setPlaylistCollaborative(id, on),
    onSuccess: (state) => {
      qc.setQueryData(collabKey(id), state);
      refresh();
    },
  });
  const newInvite = useMutation({
    mutationFn: () => api.newPlaylistInvite(id),
    onSuccess: ({ inviteCode }) => patchState({ inviteCode }),
  });
  const stopInvite = useMutation({
    mutationFn: () => api.stopPlaylistInvite(id),
    onSuccess: () => patchState({ inviteCode: null }),
  });
  const addMember = useMutation({
    mutationFn: (userId: string) => api.addPlaylistMember(id, userId),
    onSuccess: ({ members }) => {
      patchState({ members });
      refresh();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removePlaylistMember(id, userId),
    onSuccess: (res, userId) => {
      // Removing someone while the link is on replaces the link, so they
      // cannot just open it again.
      qc.setQueryData<CollabState>(collabKey(id), (prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.filter((m) => m.id !== userId),
              ...(res.inviteCode ? { inviteCode: res.inviteCode } : {}),
            }
          : prev,
      );
      refresh();
    },
  });
  const busy = [setCollaborative, newInvite, stopInvite, addMember, removeMember].some((m) => m.isPending);
  return { setCollaborative, newInvite, stopInvite, addMember, removeMember, busy };
}
