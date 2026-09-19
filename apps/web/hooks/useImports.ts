'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { QK } from '@/hooks/useLibrary';
import { isActive } from '@/lib/import/jobState';
import type { ImportItem, ImportJob } from '@/lib/import/types';
import type { Track } from '@/types/track';

/** Poll this often while an import runs (docs/imports.md, section 5). */
export const IMPORT_POLL_MS = 2000;

export const IMPORT_QK = {
  jobs: ['import-jobs'] as const,
  job: (id: string) => ['import-job', id] as const,
};

/** The user's imports the sidebar shows: polled while any is running. */
export function useImportJobs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: IMPORT_QK.jobs,
    queryFn: () => api.listImportJobs().then((r) => r.jobs),
    enabled: !!user,
    refetchInterval: (q) => (q.state.data?.some((j) => isActive(j.status)) ? IMPORT_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

/** One import with its items, for the playlist page: polled while running. */
export function useImportJob(id: string | null | undefined) {
  return useQuery({
    queryKey: IMPORT_QK.job(id ?? ''),
    queryFn: () => api.getImportJob(id as string),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.job.status) ? IMPORT_POLL_MS : false),
  });
}

/** Stop, Retry, Dismiss, and settling one song. Every change refreshes the
 *  job, the sidebar's list and the playlist's tracks. */
export function useImportActions(jobId: string | null | undefined, playlistId: string) {
  const qc = useQueryClient();
  const refresh = (job?: ImportJob, item?: ImportItem) => {
    if (jobId && job) {
      qc.setQueryData<{ job: ImportJob; items: ImportItem[] }>(IMPORT_QK.job(jobId), (old) =>
        old ? { job, items: item ? old.items.map((i) => (i.id === item.id ? item : i)) : old.items } : old,
      );
    }
    void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
    if (jobId) void qc.invalidateQueries({ queryKey: IMPORT_QK.job(jobId) });
    void qc.invalidateQueries({ queryKey: QK.playlist(playlistId) });
  };
  const update = useMutation({
    mutationFn: (action: 'cancel' | 'retry' | 'dismiss') => api.updateImportJob(jobId as string, action),
    onSuccess: (r) => refresh(r.job),
  });
  const pick = useMutation({
    mutationFn: ({ itemId, track }: { itemId: string; track: Track }) => api.pickImportItem(itemId, track),
    onSuccess: (r) => refresh(r.job, r.item),
  });
  const skip = useMutation({
    mutationFn: (itemId: string) => api.skipImportItem(itemId),
    onSuccess: (r) => refresh(r.job, r.item),
  });
  return { update, pick, skip, busy: update.isPending || pick.isPending || skip.isPending };
}
