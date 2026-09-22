import { Button } from '@/components/ui/button';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { CloseIcon, RefreshIcon, ReviewIcon } from '@/components/icons';
import { SOURCE_PHRASE } from '@/components/import/parts';
import { plainTransferResult } from '@/lib/import/transferCopy';
import type { ImportJob } from '@/lib/import/types';
import { cn } from '@/lib/utils';

export interface ImportBannerProps {
  job: ImportJob;
  /** Songs the review sheet would walk (needs review plus not found). */
  toReview: number;
  busy?: boolean;
  onStop: () => void;
  onRetry: () => void;
  onReview: () => void;
  onDismiss: () => void;
}

/** What the import is doing, above the playlist's rows: the slim progress
 *  banner while it runs, a Retry when it stopped on an error, and the Done
 *  summary with its counts and Review once it is finished. A transfer (the
 *  songs become likes) says "transfer" rather than "import" throughout, and
 *  counts the ones the person already had. */
export function ImportBanner({ job, toReview, busy = false, onStop, onRetry, onReview, onDismiss }: ImportBannerProps) {
  const from = SOURCE_PHRASE[job.source];
  const noun = job.kind === 'liked' ? 'Transfer' : 'Import';
  const verb = job.kind === 'liked' ? 'Transferring' : 'Importing';
  const waiting = job.status === 'paused' && !job.retryAt;
  if (job.status === 'queued' || job.status === 'running' || (job.status === 'paused' && !waiting)) {
    const slowed = job.status === 'paused';
    const pct = job.total ? (job.cursor / job.total) * 100 : 0;
    return (
      <div data-testid="import-progress-banner" data-status={job.status} className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-row px-block py-row">
          <ProgressRing done={job.cursor} total={job.total} size={18} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {job.status === 'queued'
                ? `Starting the ${noun.toLowerCase()} from ${from}`
                : `${verb} from ${from}, ${job.cursor} of ${job.total}`}
            </span>
            <span className="text-muted-foreground max-md:hidden">
              {slowed ? ` · ${job.error ?? 'Waiting a moment before carrying on.'}` : ' · You can leave this page, it keeps going.'}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onStop} disabled={busy}>
            Stop
          </Button>
        </div>
        <div className="h-0.5 bg-muted">
          <div className={cn('h-full transition-[width] duration-300', slowed ? 'bg-muted-foreground' : 'bg-ember')} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (waiting || job.status === 'failed') {
    return (
      <div
        data-testid="import-error-banner"
        data-status={job.status}
        className="flex items-center gap-row rounded-lg border border-border bg-card px-block py-row max-md:flex-col max-md:items-stretch"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {job.status === 'failed' ? `${noun} failed` : `${noun} paused`} at {job.cursor} of {job.total}
          </div>
          <div className="text-sm text-muted-foreground">{job.error ?? 'Something went wrong.'}</div>
        </div>
        <div className="flex items-center gap-cluster">
          <Button onClick={onRetry} disabled={busy} className="bg-ember text-white hover:bg-ember-soft max-md:flex-1">
            <RefreshIcon className="h-4 w-4" />
            Retry
          </Button>
          <Button variant="ghost" onClick={onStop} disabled={busy} className="text-muted-foreground">
            Stop
          </Button>
        </div>
      </div>
    );
  }

  // A transfer says what happened as a sentence, the same plain words the
  // dialog asked its questions in. A playlist import keeps its four
  // counters: that page is about the playlist, not about a person's likes.
  const stats: { n: number; label: string; tone: string }[] = [
    { n: job.accepted, label: 'added', tone: 'text-foreground' },
    { n: job.review, label: 'need review', tone: 'text-ember' },
    { n: job.missing, label: 'not found', tone: 'text-muted-foreground' },
  ];
  return (
    <div
      data-testid="import-summary"
      data-status={job.status}
      className="flex items-center gap-row rounded-lg border border-border bg-card px-block py-row max-md:flex-col max-md:items-stretch"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {job.status === 'cancelled' ? `${noun} stopped at ${job.cursor} of ${job.total}` : `${noun} finished`}
        </div>
        {job.kind === 'liked' ? (
          <p data-testid="transfer-result" className="mt-inset text-sm text-muted-foreground tabular-nums">
            {plainTransferResult({ found: job.accepted, check: job.review, notFound: job.missing, existing: job.existing })}
          </p>
        ) : (
          <div className="mt-inset flex flex-wrap gap-x-block gap-y-inset text-sm">
            {stats.map((s) => (
              <span key={s.label} data-testid={`import-count-${s.label.replace(' ', '-')}`} className="tabular-nums">
                <span className={cn('font-semibold', s.tone)}>{s.n}</span> <span className="text-muted-foreground">{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-cluster">
        <Button onClick={onReview} disabled={toReview === 0} className="bg-ember text-white hover:bg-ember-soft max-md:flex-1">
          <ReviewIcon className="h-4 w-4" />
          Review
        </Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} disabled={busy} className="text-muted-foreground">
          <CloseIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
