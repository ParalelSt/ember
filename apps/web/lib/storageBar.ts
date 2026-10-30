export interface StorageBarInput {
  downloadsBytes: number;
  cacheBytes: number;
  /** Total space the app can reliably know (navigator.storage.estimate quota
   *  in a browser). Leave out when unknown: the bar then scales between the
   *  two parts and no free figure is shown. */
  quotaBytes?: number | null;
  /** Everything the origin stores (estimate usage), used for the free figure
   *  only when the quota is known. */
  usageBytes?: number | null;
}

export interface StorageBarModel {
  totalBytes: number;
  /** Width of each part as a percentage of the whole bar (0 to 100). */
  downloadsPct: number;
  cachePct: number;
  /** Free bytes, or null when the app cannot know it. */
  freeBytes: number | null;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));
/** A part that exists never shrinks below this, so it stays visible. */
const MIN_VISIBLE_PCT = 1.5;

export function storageBarModel(input: StorageBarInput): StorageBarModel {
  const downloads = Math.max(0, input.downloadsBytes || 0);
  const cache = Math.max(0, input.cacheBytes || 0);
  const total = downloads + cache;
  const quota = input.quotaBytes && input.quotaBytes > 0 ? input.quotaBytes : null;

  let downloadsPct: number;
  let cachePct: number;
  let freeBytes: number | null = null;
  if (quota) {
    downloadsPct = clampPct((downloads / quota) * 100);
    cachePct = clampPct((cache / quota) * 100);
    const used = Math.max(total, input.usageBytes ?? 0);
    freeBytes = Math.max(0, quota - used);
  } else if (total > 0) {
    downloadsPct = (downloads / total) * 100;
    cachePct = (cache / total) * 100;
  } else {
    downloadsPct = 0;
    cachePct = 0;
  }
  if (downloads > 0) downloadsPct = Math.max(downloadsPct, MIN_VISIBLE_PCT);
  if (cache > 0) cachePct = Math.max(cachePct, MIN_VISIBLE_PCT);
  if (downloadsPct + cachePct > 100) {
    const k = 100 / (downloadsPct + cachePct);
    downloadsPct *= k;
    cachePct *= k;
  }
  return { totalBytes: total, downloadsPct, cachePct, freeBytes };
}
