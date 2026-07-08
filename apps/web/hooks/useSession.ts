'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import type { Track } from '@/types/track';

const POLL_MS = 2000;

export const sessionKey = (id: string) => ['session', id] as const;

/** Live session state — polls every 2s while the page is open. */
export function useQuerySession(id: string) {
  return useQuery({
    queryKey: sessionKey(id),
    queryFn: () => api.getSession(id),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function useExecuteAddToSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (track: Track) => api.addToSession(id, track),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sessionKey(id) }),
  });
}

export function useExecuteSkipSession(id: string) {
  return useMutation({ mutationFn: () => api.skipSession(id) });
}

export function useExecuteEndSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.endSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sessionKey(id) }),
  });
}

export function useExecuteSaveSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => api.saveSession(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.playlists }),
  });
}
