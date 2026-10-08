'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertIcon, CheckIcon, ChevronRightIcon, CloseIcon } from '@/components/icons';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { useImportActions, useImportJobs } from '@/hooks/useImports';
import { chipState, followedTransfer, isExactJob, shouldNotify, toCheck } from '@/lib/import/transferFollow';
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
 *  they were: a pill floats above the bottom of the page saying how far it
 *  is (tap it for about how long is left, and Stop), and when it finishes a
 *  "Transfer done" card rises in its place with the result in one line and
 *  Check N songs. Either then opens the list of songs Ember was not sure
 *  about. Lives in the app shell, so it shows on every page. */
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
  // The pill opened up: about how long is left, and Stop (or Retry).
  const [expanded, setExpanded] = useState(false);

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
  // The Transfer page has its own bar at the bottom: the pill floats above it.
  const overBar = pathname?.startsWith('/transfer') ?? false;
  const state = job ? chipState(job) : null;
  const showPill = !!job && !!state && !onReview && !notice && !(state.kind === 'done' && seen.includes(job.id));

  const openReview = (j: ImportJob) => {
    markSeen(j.id);
    setNoticeId(null);
    router.push(reviewHref(j));
  };

  const pillAt = cn(
    'absolute left-1/2 z-40 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-inset whitespace-nowrap rounded-full border border-border bg-popover/95 shadow-2xl backdrop-blur',
    overBar ? 'bottom-24' : 'bottom-row md:bottom-block',
  );
  const open = notice ? toCheck(notice) : 0;

  return (
    <>
      {showPill && state && job && (
        state.kind === 'running' || state.kind === 'paused' ? (
          <div data-testid="transfer-pill" className={cn(pillAt, 'p-inset pr-cluster')}>
            <button
              type="button"
              data-testid="transfer-chip-status"
              data-state={state.kind}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex min-w-0 items-center gap-row rounded-full pr-cluster text-left"
            >
              {state.kind === 'running' ? (
                <ProgressRing done={state.done} total={state.total} size={28} label="Transfer progress" />
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <AlertIcon className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0">
                <b className="block text-[13px]">{state.kind === 'running' ? `Transferring · ${state.percent}%` : 'Transfer paused'}</b>
                <small data-testid="transfer-pill-detail" className="block truncate text-[11.5px] text-muted-foreground">
                  {state.kind === 'paused'
                    ? state.message
                    : expanded
                      ? transferTimeLeft(state.total - state.done, isExactJob(job))
                      : `${state.done.toLocaleString('en-GB')} of ${state.total.toLocaleString('en-GB')}`}
                </small>
              </span>
            </button>
            {expanded && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={actions.update.isPending}
                onClick={() => {
                  actions.update.mutate(state.kind === 'running' ? 'cancel' : 'retry');
                  setExpanded(false);
                }}
              >
                {state.kind === 'running' ? 'Stop' : 'Retry'}
              </Button>
            )}
          </div>
        ) : (
          <button
            type="button"
            data-testid="transfer-chip-status"
            data-state={state.kind}
            onClick={() => openReview(job)}
            className={cn(pillAt, 'py-inset pl-inset pr-row text-[13px] font-semibold')}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            {state.kind === 'check' ? `${state.count} to check` : 'Transfer done'}
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )
      )}
      {notice && (
        <div
          role="status"
          data-testid="transfer-notification"
          className={cn(
            'absolute inset-x-2.5 z-50 flex flex-col gap-row rounded-[22px] border border-border bg-gradient-to-b from-card to-popover p-block shadow-2xl',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 md:left-auto md:right-6 md:w-[360px]',
            overBar ? 'bottom-24' : 'bottom-row md:bottom-block',
          )}
        >
          <div className="flex items-start gap-row">
            <button type="button" onClick={() => openReview(notice)} className="flex min-w-0 flex-1 items-start gap-row text-left">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
                <CheckIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-base">{notice.status === 'cancelled' ? 'Transfer stopped' : 'Transfer done'}</b>
                <span data-testid="transfer-notification-result" className="block text-[13px] text-muted-foreground">
                  {resultLine(notice)}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setNoticeId(null);
                if (open === 0) markSeen(notice.id);
              }}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {open > 0 && (
            <Button type="button" variant="ember" className="h-11 w-full" onClick={() => openReview(notice)}>
              Check {open} {open === 1 ? 'song' : 'songs'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
