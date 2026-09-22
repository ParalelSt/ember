import { ImportBanner } from '@/components/import/ImportBanner';
import { ImportTrackList } from '@/components/import/ImportTrackList';
import type { TrackActions } from '@/components/track/TrackList';
import { isActive } from '@/lib/import/jobState';
import { transferRows } from '@/lib/import/rows';
import type { ImportItem, ImportJob } from '@/lib/import/types';

export interface TransferBlockProps extends TrackActions {
  job: ImportJob;
  items: ImportItem[];
  busy?: boolean;
  onStop: () => void;
  onRetry: () => void;
  onReview: () => void;
  onDismiss: () => void;
  /** Opens the review sheet at this song. */
  onOpenItem: (item: ImportItem) => void;
}

/** What a transfer is doing, above the Liked songs list: the same banner a
 *  playlist import gets, and under it the songs that are not likes yet.
 *  Everything the transfer accepted is already in the list below, so this
 *  block only ever holds what is still being matched, waiting for a look,
 *  or was not found. Presentational: data in, callbacks out. */
export function TransferBlock({ job, items, busy, onStop, onRetry, onReview, onDismiss, onOpenItem, ...trackActions }: TransferBlockProps) {
  const rows = transferRows(items, job.status);
  const running = isActive(job.status);
  return (
    <div data-testid="transfer-block" className="flex flex-col gap-row">
      <ImportBanner job={job} toReview={job.review + job.missing} busy={busy} onStop={onStop} onRetry={onRetry} onReview={onReview} onDismiss={onDismiss} />
      {rows.length > 0 && (
        <div data-testid="transferring-block" className="flex flex-col gap-cluster">
          <div className="text-eyebrow">{running ? 'Transferring' : 'Still to sort out'}</div>
          <ImportTrackList rows={rows} context={null} onOpenItem={onOpenItem} {...trackActions} />
        </div>
      )}
    </div>
  );
}
