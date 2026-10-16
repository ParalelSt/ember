import { describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  createUploadQueue,
  formatMb,
  rejectReason,
  summarize,
  type UploadItem,
  type UploadProgress,
} from './uploadQueue';

/** A song of `mb` megabytes; the bytes are never read. */
function song(name: string, mb = 1, type = 'audio/mpeg'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: Math.round(mb * 1024 * 1024), configurable: true });
  return f;
}

/** An upload function whose calls the test finishes by hand. */
function controlled() {
  const calls: { file: File; p: UploadProgress; resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const upload = vi.fn(
    (file: File, p: UploadProgress) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ file, p, resolve, reject });
      }),
  );
  return { upload, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const statuses = (items: readonly UploadItem[]) => items.map((i) => `${i.name}:${i.status}`);

describe('upload queue concurrency', () => {
  it('sends at most two songs at once, the rest wait in order', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3'), song('b.mp3'), song('c.mp3'), song('d.mp3')]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(statuses(q.getSnapshot())).toEqual(['a.mp3:uploading', 'b.mp3:uploading', 'c.mp3:waiting', 'd.mp3:waiting']);

    calls[0].resolve('ok');
    await flush();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(calls[2].file.name).toBe('c.mp3');
    expect(q.getSnapshot().filter((i) => i.status === 'uploading')).toHaveLength(2);

    calls[1].resolve('ok');
    calls[2].resolve('ok');
    await flush();
    calls[3].resolve('ok');
    await flush();
    expect(statuses(q.getSnapshot())).toEqual(['a.mp3:done', 'b.mp3:done', 'c.mp3:done', 'd.mp3:done']);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it('tells listeners about each finished song with its result', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    const done = vi.fn();
    q.onUploaded(done);
    q.add([song('a.mp3')]);
    calls[0].resolve('track-a');
    await flush();
    expect(done).toHaveBeenCalledWith('track-a', expect.objectContaining({ name: 'a.mp3', status: 'done' }));
  });
});

describe('upload progress math', () => {
  it('sums the bytes sent across songs into one percent', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3', 10), song('b.mp3', 20), song('c.mp3', 20)]);
    calls[0].p.onProgress(5 * 1024 * 1024);
    calls[1].p.onProgress(5 * 1024 * 1024);
    const s = summarize(q.getSnapshot());
    expect(s).toMatchObject({ total: 3, done: 0, left: 3, failed: 0, percent: 20 });
    expect(formatMb(s.sentBytes)).toBe('10.0 MB');
    expect(formatMb(s.totalBytes)).toBe('50.0 MB');

    calls[0].resolve('ok');
    await flush();
    // a done (10) + b at 5 of 20, c just started: 15 of 50.
    expect(summarize(q.getSnapshot())).toMatchObject({ done: 1, left: 2, percent: 30 });
  });

  it('clamps progress to the file size and ignores it after the song is cancelled', () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3', 1)]);
    calls[0].p.onProgress(10 * 1024 * 1024);
    expect(q.getSnapshot()[0].loaded).toBe(1024 * 1024);
    q.cancelAll();
    calls[0].p.onProgress(1);
    expect(q.getSnapshot()).toEqual([]);
  });

  it('leaves failed songs out of the bar, so the rest can reach 100%', () => {
    const items: UploadItem[] = [
      { id: 1, file: song('a'), name: 'a', size: 100, status: 'done', loaded: 100, retryable: true },
      { id: 2, file: song('b'), name: 'b', size: 900, status: 'failed', loaded: 0, error: 'x', retryable: true },
    ];
    expect(summarize(items)).toMatchObject({ total: 1, done: 1, left: 0, failed: 1, retryable: 1, percent: 100 });
  });

  it('is zero for an empty queue', () => {
    expect(summarize([])).toMatchObject({ total: 0, percent: 0, totalBytes: 0 });
  });
});

describe('failure and retry', () => {
  it('marks a failed song with the server message and moves on to the next', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3'), song('b.mp3'), song('c.mp3')]);
    calls[0].reject(new Error('Slow down, try again in about 300s.'));
    await flush();
    const a = q.getSnapshot()[0];
    expect(a).toMatchObject({ status: 'failed', error: 'Slow down, try again in about 300s.', retryable: true });
    expect(calls[2].file.name).toBe('c.mp3');
  });

  it('Retry sends a failed song again, and it can then succeed', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3')]);
    calls[0].reject(new Error('Connection lost'));
    await flush();
    q.retry(q.getSnapshot()[0].id);
    expect(q.getSnapshot()[0].status).toBe('uploading');
    expect(upload).toHaveBeenCalledTimes(2);
    calls[1].resolve('ok');
    await flush();
    expect(q.getSnapshot()[0]).toMatchObject({ status: 'done', error: undefined });
  });

  it('retryFailed requeues every failed song but still only two go at once', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3'), song('b.mp3'), song('c.mp3')]);
    calls[0].reject(new Error('x'));
    calls[1].reject(new Error('x'));
    await flush();
    calls[2].reject(new Error('x'));
    await flush();
    expect(summarize(q.getSnapshot()).failed).toBe(3);
    q.retryFailed();
    expect(statuses(q.getSnapshot())).toEqual(['a.mp3:uploading', 'b.mp3:uploading', 'c.mp3:waiting']);
  });

  it('fails a file too large or not audio at once, without sending it, and Retry leaves it alone', () => {
    const { upload } = controlled();
    const q = createUploadQueue(upload);
    const big = song('big.wav', 51, 'audio/wav');
    q.add([big, song('notes.pdf', 1, 'application/pdf')]);
    expect(upload).not.toHaveBeenCalled();
    expect(q.getSnapshot().map((i) => i.error)).toEqual(['Too large: the limit is 50 MB', 'Not a supported audio file']);
    q.retryFailed();
    expect(upload).not.toHaveBeenCalled();
    expect(summarize(q.getSnapshot())).toMatchObject({ failed: 2, retryable: 0 });
  });
});

describe('cancel', () => {
  it('Cancel all aborts the songs going up, drops the waiting ones and empties the card', async () => {
    const { upload, calls } = controlled();
    const q = createUploadQueue(upload);
    q.add([song('a.mp3'), song('b.mp3'), song('c.mp3')]);
    const signals = calls.map((c) => c.p.signal);
    q.cancelAll();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(q.getSnapshot()).toEqual([]);
    // A song that answers after it was cancelled does not come back.
    calls[0].resolve('late');
    calls[1].reject(new Error('aborted'));
    await flush();
    expect(q.getSnapshot()).toEqual([]);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const { upload } = controlled();
    const q = createUploadQueue(upload);
    const l = vi.fn();
    const off = q.subscribe(l);
    q.add([song('a.mp3')]);
    expect(l).toHaveBeenCalled();
    off();
    l.mockClear();
    q.clear();
    expect(l).not.toHaveBeenCalled();
  });
});

describe('rejectReason', () => {
  it('accepts the audio the server takes, by type or by extension', () => {
    expect(rejectReason(song('a.mp3', 1, 'audio/mpeg'))).toBeNull();
    expect(rejectReason(song('a.flac', 1, ''))).toBeNull();
    expect(rejectReason(song('a.m4a', 1, 'audio/x-m4a'))).toBeNull();
  });

  it('refuses empty, too large and non-audio files', () => {
    expect(rejectReason(song('a.mp3', 0))).toBe('That file is empty');
    const edge = song('a.mp3');
    Object.defineProperty(edge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    expect(rejectReason(edge)).toMatch(/50 MB/);
    expect(rejectReason(song('a.txt', 1, 'text/plain'))).toBe('Not a supported audio file');
  });
});
