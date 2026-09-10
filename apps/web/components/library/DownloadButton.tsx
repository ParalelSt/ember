import { Button } from '@/components/ui/button';
import { CheckIcon, CloudDownloadIcon, XCircleIcon } from '@/components/icons';

export interface DownloadButtonProps {
  state: 'idle' | 'downloading' | 'downloaded' | 'stale';
  progress?: { current: number; total: number };
  disabled?: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onUpdate: () => void;
}

/** Presentational only: the three-way (four counting stale) offline download
 *  button. Which callback fires and what it looks like is entirely driven by
 *  `state`; the caller (useOfflinePin) owns what each state means. */
export function DownloadButton({ state, progress, disabled, onDownload, onCancel, onRemove, onUpdate }: DownloadButtonProps) {
  if (state === 'downloading') {
    return (
      <Button variant="outline" size="sm" onClick={onCancel} title="Cancel download">
        <XCircleIcon className="h-4 w-4" />
        Downloading…
        {progress && <span className="tabular-nums">{progress.current}/{progress.total}</span>}
      </Button>
    );
  }
  if (state === 'downloaded') {
    return (
      <Button variant="outline" size="sm" onClick={onRemove} title="Remove offline copy" className="text-ember border-ember/40">
        <CheckIcon className="h-4 w-4" />
        Downloaded
      </Button>
    );
  }
  if (state === 'stale') {
    return (
      <Button variant="outline" size="sm" onClick={onUpdate} title="Update offline copy">
        <CloudDownloadIcon className="h-4 w-4" />
        Update download
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onDownload} disabled={disabled} title="Save this collection for offline playback">
      <CloudDownloadIcon className="h-4 w-4" />
      Download for offline
    </Button>
  );
}
