'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertIcon, CheckIcon, CloseIcon, FlameIcon } from '@/components/icons';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { useImportActions, useImportJobs } from '@/hooks/useImports';
import { chipState, followedTransfer, isExactJob, shouldNotify } from '@/lib/import/transferFollow';
import { plainTransferResult, transferTimeLeft } from '@/lib/import/transferCopy';
import type { JobStatus } from '@/lib/import/jobState';
import type { ImportJob } from '@/lib/import/types';
import { useTransferStore } from '@/stores/useTransferStore';
import { cn } from '@/lib/utils';

/** The one list of songs Ember was not sure about. */
export const reviewHref = (job: ImportJob) => `/transfer/review?job=${encodeURIComponent(job.id)}`;

/** The result of a finished transfer as one plain line. */
export function resultLine(job: ImportJob): string {
  return plainTransferResult({
    found: job.accepted,
    check: job.review,
    notFound: job.missing,
    existing: job.existing,
    notMusic: job.notMusic,
  });
}

/** A transfer runs in the background while the person carries on where
 *  they were: a small chip in the corner says how far it is (tap it for "X
 *  of Y, about N minutes left", and Stop), and when it finishes an in-app
 *  notification says "Transfer done" with the result in one line. Tapping
 *  either then opens the list of songs Ember was not sure about. Lives in
 *  the app shell, so it shows on every page. */
export function TransferStatus() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: jobs = [] } = useImportJobs();
  const followed = useTransferStore((s) => s.followed);
  const notified = useTransferStore((s) => s.notified);
  const seen = useTransferStore((s) => s.seen);
  const markNotified = useTransferStore((s) => s.markNotified);
  const markSeen = useTransferStore((s) => s.markSeen);
  const job = followedTransfer(jobs, followed);
  const actions = useImportActions(job?.id, job?.playlistId ?? null);
  const [noticeId, setNoticeId] = useState<string | null>(null);

  // What each transfer was last time the list came in, so a finish is seen
  // as it happens.
  const before = useRef<Record<string, JobStatus>>({});
  useEffect(() => {
    if (job && shouldNotify(before.current[job.id], job, followed, notified)) {
      markNotified(job.id);
      setNoticeId(job.id);
    }
    before.current = Object.fromEntries(jobs.map((j) => [j.id, j.status]));
  }, [jobs, job, followed, notified, markNotified]);

  const notice = noticeId ? (jobs.find((j) => j.id === noticeId) ?? null) : null;
  // The list page is about this transfer already.
  const onReview = pathname?.startsWith('/transfer/review') ?? false;
  const state = job ? chipState(job) : null;
  const showChip = !!job && !!state && !onReview && !(state.kind === 'done' && seen.includes(job.id));

  const openReview = (j: ImportJob) => {
    markSeen(j.id);
    setNoticeId(null);
    router.push(reviewHref(j));
  };

  const tapChip = () => {
    if (!job || !state) return;
    if (state.kind === 'running') {
      toast(`${state.done.toLocaleString('en-GB')} of ${state.total.toLocaleString('en-GB')}, ${transferTimeLeft(state.total - state.done, isExactJob(job)).toLowerCase()}`, {
        id: 'transfer-progress',
        action: { label: 'Stop', onClick: () => actions.update.mutate('cancel') },
      });
      return;
    }
    if (state.kind === 'paused') {
      toast(state.message, {
        id: 'transfer-progress',
        action: { label: 'Retry', onClick: () => actions.update.mutate('retry') },
      });
      return;
    }
    openReview(job);
  };

  return (
    <>
      {showChip && state && (
        <button
          type="button"
          data-testid="transfer-chip-status"
          data-state={state.kind}
          onClick={tapChip}
          className="absolute right-3 top-2 z-40 inline-flex h-8 items-center gap-cluster rounded-full border border-border bg-popover pl-cluster pr-row text-xs font-semibold shadow-lg md:right-6 md:top-3"
        >
          {state.kind === 'running' ? (
            <>
              <ProgressRing done={state.done} total={state.total} size={16} label="Transfer progress" />
              Transfer {state.percent}%
            </>
          ) : state.kind === 'paused' ? (
            <>
              <AlertIcon className="h-4 w-4 text-muted-foreground" />
              Transfer paused
            </>
          ) : (
            <>
              <CheckIcon className="h-4 w-4 text-ember" />
              {state.kind === 'check' ? `${state.count} to check` : 'Transfer done'}
            </>
          )}
        </button>
      )}
      {notice && (
        <div
          role="status"
          data-testid="transfer-notification"
          className={cn(
            'absolute inset-x-2 top-2 z-50 flex items-start gap-inset rounded-2xl border border-border bg-popover/95 p-cluster shadow-2xl backdrop-blur',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 md:left-auto md:right-6 md:w-[340px]',
          )}
        >
          <button type="button" onClick={() => openReview(notice)} className="flex min-w-0 flex-1 gap-row px-inset py-inset text-left">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ember text-ember-foreground">
              <FlameIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">Ember · now</span>
              <b className="block text-sm">{notice.status === 'cancelled' ? 'Transfer stopped' : 'Transfer done'}</b>
              <span data-testid="transfer-notification-result" className="block text-[13px]">
                {resultLine(notice)}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setNoticeId(null);
              if (toCheckNone(notice)) markSeen(notice.id);
            }}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

/** Nothing left to check: once its notification is gone, so is the chip. */
function toCheckNone(job: ImportJob): boolean {
  return job.review + job.missing === 0;
}
