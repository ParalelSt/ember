'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const ADMIN_QK = {
  users: ['admin', 'users'] as const,
  tracks: (page: number, q: string) => ['admin', 'tracks', page, q] as const,
};

// ───── Users ─────

export function useQueryAdminUsers() {
  return useQuery({
    queryKey: ADMIN_QK.users,
    queryFn: () => api.admin.listUsers().then((r) => r.users),
  });
}

export function useExecuteUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; isAdmin?: boolean } }) =>
      api.admin.updateUser(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_QK.users });
    },
  });
}

export function useExecuteDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_QK.users });
    },
  });
}

export function useExecuteResetAdminUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.admin.resetUserPassword(id, password),
  });
}

// ───── Tracks ─────

export function useQueryAdminTracks(page: number, q: string) {
  return useQuery({
    queryKey: ADMIN_QK.tracks(page, q),
    queryFn: () => api.admin.listTracks({ page, q }),
  });
}

export function useExecuteUpdateAdminTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, patch }: { recordId: string; patch: { title?: string; artist?: string; album?: string } }) =>
      api.admin.updateTrack(recordId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tracks'] });
    },
  });
}

export function useExecuteDeleteAdminTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.admin.deleteTrack(recordId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tracks'] });
    },
  });
}

// ───── Invites ─────

const INVITES_QK = ['admin', 'invites'] as const;

export function useQueryAdminInvites() {
  return useQuery({
    queryKey: INVITES_QK,
    queryFn: () => api.admin.listInvites().then((r) => r.invites),
  });
}

export function useExecuteAddAdminInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.admin.addInvite(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVITES_QK });
    },
  });
}

export function useExecuteDeleteAdminInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.deleteInvite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INVITES_QK });
    },
  });
}

// ───── Backups ─────

const BACKUPS_QK = ['admin', 'backups'] as const;

export function useQueryAdminBackups() {
  return useQuery({
    queryKey: BACKUPS_QK,
    queryFn: () => api.admin.backups(),
  });
}

export function useExecuteBackupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.backupNow(),
    onSuccess: (status) => {
      qc.setQueryData(BACKUPS_QK, status);
    },
  });
}

// ───── Pranks ─────

const PRANKS_QK = {
  people: ['admin', 'pranks', 'people'] as const,
  log: ['admin', 'pranks', 'log'] as const,
  settings: ['admin', 'pranks', 'settings'] as const,
  sounds: ['admin', 'pranks', 'sounds'] as const,
  schedules: ['admin', 'pranks', 'schedules'] as const,
};

export function useQueryPrankPeople() {
  return useQuery({
    queryKey: PRANKS_QK.people,
    queryFn: () => api.admin.pranks.people().then((r) => r.people),
    refetchInterval: 10_000,
  });
}

export function useQueryPrankLog() {
  return useQuery({
    queryKey: PRANKS_QK.log,
    queryFn: () => api.admin.pranks.list(),
    refetchInterval: 3_000,
  });
}

export function useQueryPrankSettings() {
  return useQuery({
    queryKey: PRANKS_QK.settings,
    queryFn: () => api.admin.pranks.settings(),
  });
}

export function useExecuteSendPrank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.admin.pranks.send>[0]) => api.admin.pranks.send(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.log });
      qc.invalidateQueries({ queryKey: PRANKS_QK.people });
    },
  });
}

export function useExecuteSetPranksEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.admin.pranks.setEnabled(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pranks'] });
    },
  });
}

export function useQueryPrankSounds() {
  return useQuery({
    queryKey: PRANKS_QK.sounds,
    queryFn: () => api.admin.pranks.sounds().then((r) => r.sounds),
  });
}

export function useExecuteUploadPrankSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.admin.pranks.uploadSound>[0]) => api.admin.pranks.uploadSound(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.sounds });
    },
  });
}

export function useExecuteDeletePrankSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.pranks.deleteSound(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.sounds });
    },
  });
}

export function useExecuteRenamePrankSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.admin.pranks.renameSound(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.sounds });
    },
  });
}

export function useQueryPrankSchedules() {
  return useQuery({
    queryKey: PRANKS_QK.schedules,
    queryFn: () => api.admin.pranks.schedules().then((r) => r.schedules),
    refetchInterval: 5_000,
  });
}

export function useExecuteRepeatPrank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.admin.pranks.repeat>[0]) => api.admin.pranks.repeat(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.schedules });
      qc.invalidateQueries({ queryKey: PRANKS_QK.log });
    },
  });
}

export function useExecuteStopRepeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.admin.pranks.stopRepeat(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRANKS_QK.schedules });
      qc.invalidateQueries({ queryKey: PRANKS_QK.log });
    },
  });
}

export function useExecuteStopAllPranks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.pranks.stopAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'pranks'] });
    },
  });
}
