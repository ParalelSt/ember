/** Which transfer the progress chip follows, what it says, and when the
 *  "Transfer done" notification shows. Pure, so the chip's states are
 *  tested without a query client. */

import { isActive, type JobStatus } from '@/lib/import/jobState';
import type { ImportJob } from '@/lib/import/types';

/** The transfer to report on: the newest one not dismissed that fills the
 *  likes, or that this device started from the Transfer page (a new
 *  playlist). Jobs come newest first. */
export function followedTransfer(jobs: readonly ImportJob[], followed: readonly string[]): ImportJob | null {
  return jobs.find((j) => !j.dismissed && (j.kind === 'liked' || followed.includes(j.id))) ?? null;
}

/** Songs that wait for the person: unsure, or not found. */
export function toCheck(job: ImportJob): number {
  return job.review + job.missing;
}

/** A transfer whose songs name their own videos searches for nothing. */
export function isExactJob(job: ImportJob): boolean {
  return job.source === 'ytmusic' || job.source === 'youtube';
}

export type ChipState =
  | { kind: 'running'; done: number; total: number; percent: number }
  | { kind: 'paused'; message: string }
  | { kind: 'check'; count: number }
  | { kind: 'done' };

export function chipState(job: ImportJob): ChipState {
  // Paused with a retry time is a backoff that carries on by itself.
  const waiting = (job.status === 'paused' && !job.retryAt) || job.status === 'failed';
  if (waiting) return { kind: 'paused', message: job.error ?? 'The transfer stopped. Try again.' };
  if (isActive(job.status)) {
    return { kind: 'running', done: job.cursor, total: job.total, percent: job.total ? Math.round((job.cursor / job.total) * 100) : 0 };
  }
  const n = toCheck(job);
  return n > 0 ? { kind: 'check', count: n } : { kind: 'done' };
}

/** Says "Transfer done" once a transfer finishes: seen finishing while the
 *  app was open, or started on this device and finished while it was
 *  closed. Never twice for the same transfer. */
export function shouldNotify(
  before: JobStatus | undefined,
  job: ImportJob,
  followed: readonly string[],
  notified: readonly string[],
): boolean {
  if (job.status !== 'done' && job.status !== 'cancelled') return false;
  if (notified.includes(job.id)) return false;
  return (before !== undefined && isActive(before)) || followed.includes(job.id);
}
