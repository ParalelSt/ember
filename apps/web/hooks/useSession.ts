'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/useSessionStore';
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

/** Lets go of this device's hosting flag (stores/useSessionStore, which
 *  turns radio off) once the server says its carlist is no longer live:
 *  ended elsewhere, or left alone past the live window because the host
 *  just closed the app. Only the session page cleared it before, and only
 *  when the host came back to an ended carlist, so radio could stay off for
 *  good. Mounted once, app-wide. An answer cached from before the flag was
 *  set says nothing about the carlist that set it, so only a later one
 *  counts. */
export function useReleaseStaleHosting() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const hostingId = useSessionStore((s) => s.hostingSessionId);
  const setHostingSessionId = useSessionStore((s) => s.setHostingSessionId);
  const { data, dataUpdatedAt, isSuccess } = useQuery({
    queryKey: liveCarlistKey,
    queryFn: () => api.getLiveCarlist().then((r) => r.carlist),
    enabled: !!user && !!hostingId,
    refetchInterval: LIVE_POLL_MS,
  });
  // How many answers the live query had when the flag was set.
  const baseline = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  if (baseline.current.id !== hostingId) {
    baseline.current = { id: hostingId, count: qc.getQueryState(liveCarlistKey)?.dataUpdateCount ?? 0 };
  }

  useEffect(() => {
    if (!hostingId || !isSuccess) return;
    const count = qc.getQueryState(liveCarlistKey)?.dataUpdateCount ?? 0;
    if (count <= baseline.current.count) return;
    if (!data || data.id !== hostingId || !data.isHost) setHostingSessionId(null);
  }, [qc, hostingId, isSuccess, data, dataUpdatedAt, setHostingSessionId]);
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
