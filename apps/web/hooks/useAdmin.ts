'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const ADMIN_QK = {
  users: ['admin', 'users'] as const,
  tracks: (page: number, q: string) => ['admin', 'tracks', page, q] as const,
  logs: (categories: string[], q: string, limit: number) =>
    ['admin', 'logs', categories.join(','), q, limit] as const,
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

// ───── Logs ─────

export function useQueryAdminLogs(categories: string[], q: string, limit: number) {
  return useQuery({
    queryKey: ADMIN_QK.logs(categories, q, limit),
    queryFn: () => api.admin.listLogs({ categories, q, limit }),
  });
}

export function useExecuteClearAdminLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.clearLogs(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'logs'] });
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
