'use client';

import { useEffect, useState } from 'react';
import { formatBytes } from '@/lib/format';
import { storageBarModel } from '@/lib/storageBar';

/** Total space the app can reliably know. Only a browser tab has an honest
 *  answer (navigator.storage.estimate, the quota of this origin); the native
 *  shells report none, so the bar there scales between its two parts. */
function useStorageEstimate(enabled: boolean): { quota: number; usage: number } | null {
  const [est, setEst] = useState<{ quota: number; usage: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return;
    let live = true;
    storage.estimate().then(
      (e) => {
        if (live && e.quota && e.quota > 0) setEst({ quota: e.quota, usage: e.usage ?? 0 });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return est;
}

/** Settings > Downloads: the total, a thin bar split into Downloads (ember)
 *  and Automatic cache, and a key with both sizes. */
export function StorageBar({
  downloadsBytes,
  cacheBytes,
  canEstimate,
}: {
  downloadsBytes: number;
  cacheBytes: number;
  /** False in the native shells, where the estimate is not about the device. */
  canEstimate: boolean;
}) {
  const est = useStorageEstimate(canEstimate);
  const m = storageBarModel({
    downloadsBytes,
    cacheBytes,
    quotaBytes: est?.quota ?? null,
    usageBytes: est?.usage ?? null,
  });
  return (
    <div className="rounded-md bg-card px-block py-row" data-testid="storage-bar">
      <div className="flex items-baseline justify-between gap-row">
        <div className="text-2xl font-bold tabular-nums" data-testid="storage-total">
          {formatBytes(m.totalBytes)}
        </div>
        {m.freeBytes !== null && (
          <div className="text-meta tabular-nums" data-testid="storage-free">
            {formatBytes(m.freeBytes)} free
          </div>
        )}
      </div>
      <div
        className="mt-row flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Downloads ${formatBytes(downloadsBytes)}, automatic cache ${formatBytes(cacheBytes)}`}
      >
        <div className="h-full bg-ember" style={{ width: `${m.downloadsPct}%` }} data-testid="storage-seg-downloads" />
        <div className="h-full bg-muted-foreground" style={{ width: `${m.cachePct}%` }} data-testid="storage-seg-cache" />
      </div>
      <div className="mt-row flex flex-wrap gap-x-block gap-y-inset text-xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-inset">
          <span className="h-2 w-2 rounded-full bg-ember" aria-hidden="true" />
          Downloads {formatBytes(downloadsBytes)}
        </span>
        <span className="inline-flex items-center gap-inset">
          <span className="h-2 w-2 rounded-full bg-muted-foreground" aria-hidden="true" />
          Automatic cache {formatBytes(cacheBytes)}
        </span>
      </div>
    </div>
  );
}
