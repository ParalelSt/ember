'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useAuth } from '@/components/providers/AuthProvider';
import type { AddPosition } from '@/lib/carlist';
import type { Track } from '@/types/track';

const POLL_MS = 2000;
const LIVE_POLL_MS = 30_000;

export const sessionKey = (id: string) => ['session', id] as const;
export const liveCarlistKey = ['carlist', 'live'] as const;

/** Live session state — polls every 2s while the page is open. */
export function useQuerySession(id: string) {
  return useQuery({
    queryKey: sessionKey(id),
    queryFn: () => api.getSession(id),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/** The live carlist this user hosts or joined (null when none): what the
 *  Carlist button in Your library shows. */
export function useQueryLiveCarlist() {
  const { user } = useAuth();
  return useQuery({
    queryKey: liveCarlistKey,
    queryFn: () => api.getLiveCarlist().then((r) => r.carlist),
    enabled: !!user,
    refetchInterval: LIVE_POLL_MS,
  });
}

export function useExecuteAddToSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ track, position }: { track: Track; position: AddPosition }) =>
      api.addToSession(id, track, position),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sessionKey(id) }),
  });
}

export function useExecuteSkipSession(id: string) {
  return useMutation({ mutationFn: (index?: number) => api.skipSession(id, index) });
}

export function useExecuteEndSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.endSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionKey(id) });
      void qc.invalidateQueries({ queryKey: liveCarlistKey });
    },
  });
}

export function useExecuteSaveSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => api.saveSession(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.playlists }),
  });
}
