'use client';

import { formatMb, summarize, type UploadItem } from '@/lib/uploadQueue';

interface Props {
  items: readonly UploadItem[];
  onRetryFailed: () => void;
  onCancelAll: () => void;
  onClear: () => void;
}

/** One combined card for everything going up: "Uploading 2 of 4 songs",
 *  the overall percent, megabytes sent of the total and one bar. Failed
 *  songs show as a count with Retry; Cancel all stops the rest, and once
 *  nothing is going it reads Clear. Nothing renders with an empty queue. */
export function UploadProgressCard({ items, onRetryFailed, onCancelAll, onClear }: Props) {
  if (items.length === 0) return null;
  const s = summarize(items);
  const busy = s.left > 0;
  const failed = items.filter((it) => it.status === 'failed');

  const headline = busy
    ? `Uploading ${s.done} of ${s.total} ${s.total === 1 ? 'song' : 'songs'}`
    : s.total > 0
      ? s.total === 1 ? 'Song uploaded' : 'All songs uploaded'
      : 'Nothing uploaded';

  return (
    <section
      aria-label="Upload progress"
      data-testid="upload-progress"
      className="flex flex-col gap-cluster rounded-2xl border border-border bg-card p-block"
    >
      <div className="flex items-baseline justify-between gap-row font-semibold">
        <span className="min-w-0 truncate" data-testid="upload-headline">{headline}</span>
        <span className="text-xl tabular-nums" data-testid="upload-percent">{s.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={s.percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-ember transition-[width]" style={{ width: `${s.percent}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-cluster text-xs text-muted-foreground">
        <span className="tabular-nums" data-testid="upload-bytes">
          {formatMb(s.sentBytes)} of {formatMb(s.totalBytes)}
        </span>
        {s.failed > 0 && (
          <span className="flex items-center gap-inset text-ember">
            <span data-testid="upload-failed">{s.failed} failed</span>
            {s.retryable > 0 && (
              <button type="button" onClick={onRetryFailed} className="font-semibold hover:underline">
                Retry
              </button>
            )}
          </span>
        )}
        <button
          type="button"
          onClick={busy ? onCancelAll : onClear}
          className="font-semibold text-ember hover:underline"
        >
          {busy ? 'Cancel all' : 'Clear'}
        </button>
      </div>
      {failed.length > 0 && (
        <ul className="flex flex-col text-xs text-muted-foreground" data-testid="upload-errors">
          {failed.map((it) => (
            <li key={it.id} className="truncate">
              {it.name}: {it.error ?? 'Upload failed'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
