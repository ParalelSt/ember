/** The Settings > Uploads queue: songs a member picked or dropped, sent to
 *  POST /api/uploads at most two at a time, with real byte progress.
 *
 *  Plain TypeScript with a subscribe/snapshot pair, so React reads it
 *  through useSyncExternalStore (hooks/useUploadQueue) and tests drive it
 *  without a DOM. The network call is injected: the app passes the
 *  XMLHttpRequest one (lib/uploadXhr), tests pass a fake. */

/** Same cap as the server (lib/uploads MAX_UPLOAD_BYTES, MAX_UPLOAD_MB=50):
 *  checked here too so a too-big song fails at once instead of after
 *  sending 50 MB. The server still decides. */
export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
/** Songs going up at once. */
export const UPLOAD_CONCURRENCY = 2;

/** The audio the server accepts (lib/uploads ALLOWED_TYPES), by type and by
 *  extension: phones often hand over a file with no type at all. */
export const UPLOAD_ACCEPT = 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.webm';
const AUDIO_EXTS = ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav', 'webm'];
const AUDIO_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac',
  'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/webm',
];

export type UploadStatus = 'waiting' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  id: number;
  file: File;
  name: string;
  size: number;
  status: UploadStatus;
  /** Bytes of the file sent so far. */
  loaded: number;
  /** Why it failed, in words for the member (the server's message when it
   *  sent one). */
  error?: string;
  /** False for a file that would fail again the same way (too big, not
   *  audio): Retry leaves it alone. */
  retryable: boolean;
}

export interface UploadProgress {
  onProgress: (loaded: number) => void;
  signal: AbortSignal;
}

/** Sends one file. Resolves when the server has stored it; rejects with an
 *  Error whose message is shown to the member. */
export type UploadFn<T = unknown> = (file: File, progress: UploadProgress) => Promise<T>;

export interface UploadSummary {
  /** Songs counted in the card: uploading, waiting and done. */
  total: number;
  done: number;
  /** Still to go: uploading plus waiting. */
  left: number;
  failed: number;
  /** Failed ones Retry would send again. */
  retryable: number;
  totalBytes: number;
  sentBytes: number;
  /** Whole percent of the bytes sent, 0 to 100. */
  percent: number;
}

/** A local check before any byte goes out: the reason a file cannot be
 *  uploaded, or null when it may try. */
export function rejectReason(file: File): string | null {
  if (file.size === 0) return 'That file is empty';
  if (file.size > MAX_UPLOAD_BYTES) return `Too large: the limit is ${MAX_UPLOAD_MB} MB`;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = (file.type || '').toLowerCase();
  if (type ? AUDIO_TYPES.includes(type) || (type.startsWith('audio/') && AUDIO_EXTS.includes(ext)) : AUDIO_EXTS.includes(ext)) {
    return null;
  }
  return 'Not a supported audio file';
}

/** The combined card's numbers. Failed songs are left out of the bar and
 *  the count, so one failure does not hold the percent below 100. */
export function summarize(items: readonly UploadItem[]): UploadSummary {
  let total = 0, done = 0, left = 0, failed = 0, retryable = 0, totalBytes = 0, sentBytes = 0;
  for (const it of items) {
    if (it.status === 'failed') {
      failed++;
      if (it.retryable) retryable++;
      continue;
    }
    total++;
    totalBytes += it.size;
    if (it.status === 'done') {
      done++;
      sentBytes += it.size;
    } else {
      left++;
      if (it.status === 'uploading') sentBytes += Math.min(it.loaded, it.size);
    }
  }
  const percent = totalBytes > 0 ? Math.min(100, Math.floor((sentBytes / totalBytes) * 100)) : total > 0 && left === 0 ? 100 : 0;
  return { total, done, left, failed, retryable, totalBytes, sentBytes, percent };
}

/** "12.3 MB": the card's megabytes, one decimal. */
export function formatMb(bytes: number): string {
  return `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)} MB`;
}

export interface UploadQueue<T = unknown> {
  add: (files: Iterable<File>) => void;
  retry: (id: number) => void;
  retryFailed: () => void;
  /** Stops every song still going and empties the card. Songs already
   *  uploaded stay uploaded. */
  cancelAll: () => void;
  /** Empties the card once nothing is going (same as cancelAll then). */
  clear: () => void;
  getSnapshot: () => readonly UploadItem[];
  subscribe: (listener: () => void) => () => void;
  /** For callers that want each finished upload (the page refreshes the
   *  lists). */
  onUploaded: (listener: (result: T, item: UploadItem) => void) => () => void;
}

export function createUploadQueue<T = unknown>(
  upload: UploadFn<T>,
  { concurrency = UPLOAD_CONCURRENCY }: { concurrency?: number } = {},
): UploadQueue<T> {
  let items: readonly UploadItem[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const uploadedListeners = new Set<(result: T, item: UploadItem) => void>();
  const controllers = new Map<number, AbortController>();

  const emit = () => listeners.forEach((l) => l());
  const patch = (id: number, change: Partial<UploadItem>) => {
    let hit = false;
    items = items.map((it) => {
      if (it.id !== id) return it;
      hit = true;
      return { ...it, ...change };
    });
    return hit;
  };

  const start = (item: UploadItem) => {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    patch(item.id, { status: 'uploading', loaded: 0, error: undefined });
    upload(item.file, {
      signal: controller.signal,
      onProgress: (loaded) => {
        if (controller.signal.aborted) return;
        if (patch(item.id, { loaded: Math.max(0, Math.min(loaded, item.size)) })) emit();
      },
    }).then(
      (result) => {
        controllers.delete(item.id);
        if (controller.signal.aborted) return;
        if (patch(item.id, { status: 'done', loaded: item.size })) {
          const finished = items.find((it) => it.id === item.id)!;
          uploadedListeners.forEach((l) => l(result, finished));
        }
        pump();
      },
      (e: unknown) => {
        controllers.delete(item.id);
        if (controller.signal.aborted) return;
        const message = e instanceof Error && e.message ? e.message : 'Upload failed';
        patch(item.id, { status: 'failed', loaded: 0, error: message, retryable: true });
        pump();
      },
    );
  };

  /** Starts waiting songs, oldest first, while fewer than `concurrency`
   *  are going. */
  const pump = () => {
    let running = items.filter((it) => it.status === 'uploading').length;
    for (const it of items) {
      if (running >= concurrency) break;
      if (it.status !== 'waiting') continue;
      start(it);
      running++;
    }
    emit();
  };

  const reset = () => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    items = [];
    emit();
  };

  return {
    add(files) {
      const added: UploadItem[] = [];
      for (const file of files) {
        const reason = rejectReason(file);
        added.push({
          id: nextId++,
          file,
          name: file.name,
          size: file.size,
          status: reason ? 'failed' : 'waiting',
          loaded: 0,
          error: reason ?? undefined,
          retryable: !reason,
        });
      }
      if (added.length === 0) return;
      items = [...items, ...added];
      pump();
    },
    retry(id) {
      const it = items.find((x) => x.id === id);
      if (!it || it.status !== 'failed' || !it.retryable) return;
      patch(id, { status: 'waiting', loaded: 0, error: undefined });
      pump();
    },
    retryFailed() {
      items = items.map((it) =>
        it.status === 'failed' && it.retryable ? { ...it, status: 'waiting' as const, loaded: 0, error: undefined } : it,
      );
      pump();
    },
    cancelAll: reset,
    clear: reset,
    getSnapshot: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onUploaded(listener) {
      uploadedListeners.add(listener);
      return () => uploadedListeners.delete(listener);
    },
  };
}
