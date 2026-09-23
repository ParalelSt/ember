'use client';

import { useEffect, useMemo, useRef } from 'react';
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

/** One import with its items, for the playlist page: polled while running
 *  unless `poll` is false (the Liked page, which follows the jobs list). */
export function useImportJob(id: string | null | undefined, { poll = true }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: IMPORT_QK.job(id ?? ''),
    queryFn: () => api.getImportJob(id as string),
    enabled: !!id,
    refetchInterval: (q) => (poll && q.state.data && isActive(q.state.data.job.status) ? IMPORT_POLL_MS : false),
  });
}

/** The parts of a transfer's summary that change which of its items the
 *  Liked page shows: a song that needs a look or was not found, or the end
 *  of the run. A song accepted changes nothing there (it is a like now). */
function itemsKey(job: ImportJob): string {
  return `${job.id}:${job.status}:${job.review}:${job.missing}`;
}

/** The newest transfer the Liked page reports on: the job whose songs
 *  become likes, unless it has been dismissed. Pure, so the page's states
 *  can be tested without a query client. */
export function newestLikedJob(jobs: ImportJob[]): ImportJob | null {
  // The list comes newest first, which is the order the sidebar ring uses
  // too (lib/import/nav.ts).
  return jobs.find((j) => j.kind === 'liked' && !j.dismissed) ?? null;
}

/** The Liked page's transfer, with its songs. The summary from the jobs
 *  list is shown until the detail arrives, so the banner does not flash in
 *  a moment after the page.
 *
 *  A transfer can be thousands of songs, so while it runs only the jobs
 *  list is polled. Each new summary is copied into the detail, and the
 *  items are fetched again only when itemsKey changes. In between, songs
 *  below the cursor have been matched, so they no longer show as waiting. */
export function useLikedImportJob(): { job: ImportJob | null; items: ImportItem[] } {
  const qc = useQueryClient();
  const { data: jobs = [] } = useImportJobs();
  const summary = newestLikedJob(jobs);
  const detail = useImportJob(summary?.id, { poll: false });

  const lastKey = useRef(summary ? itemsKey(summary) : '');
  useEffect(() => {
    if (!summary) return;
    qc.setQueryData<{ job: ImportJob; items: ImportItem[] }>(IMPORT_QK.job(summary.id), (old) =>
      old ? { ...old, job: summary } : old,
    );
    const key = itemsKey(summary);
    if (key === lastKey.current) return;
    const first = !lastKey.current;
    lastKey.current = key;
    // The first summary is fetched by the detail query itself.
    if (!first) void qc.invalidateQueries({ queryKey: IMPORT_QK.job(summary.id) });
  }, [summary, qc]);

  const job = detail.data?.job ?? summary;
  const raw = detail.data?.items;
  const cursor = job?.cursor ?? 0;
  const items = useMemo(
    () => (raw ?? []).filter((i) => !(i.status === 'pending' && i.position < cursor)),
    [raw, cursor],
  );
  return { job, items };
}

/** Stop, Retry, Dismiss, and settling one song. Every change refreshes the
 *  job, the sidebar's list and wherever the songs land: a playlist's tracks,
 *  or the likes when this is a transfer (no playlist at all). */
export function useImportActions(jobId: string | null | undefined, playlistId: string | null) {
  const qc = useQueryClient();
  const refresh = (job?: ImportJob, item?: ImportItem) => {
    if (jobId && job) {
      qc.setQueryData<{ job: ImportJob; items: ImportItem[] }>(IMPORT_QK.job(jobId), (old) =>
        old ? { job, items: item ? old.items.map((i) => (i.id === item.id ? item : i)) : old.items } : old,
      );
    }
    void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
    if (jobId) void qc.invalidateQueries({ queryKey: IMPORT_QK.job(jobId) });
    if (playlistId) void qc.invalidateQueries({ queryKey: QK.playlist(playlistId) });
    else void qc.invalidateQueries({ queryKey: QK.likes });
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
