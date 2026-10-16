import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sessionExpired', () => ({ sessionExpired: vi.fn() }));
const { uploadSongXhr } = await import('./uploadXhr');
const { sessionExpired } = await import('@/lib/sessionExpired');

/** Just enough XMLHttpRequest to drive one upload from the test. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  withCredentials = false;
  status = 0;
  responseText = '';
  body: FormData | null = null;
  aborted = false;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }
}

const sent = () => new Promise((r) => setTimeout(r, 0));
const file = (name = 'Night Riders - Neon Hearts.mp3') => {
  const f = new File(['x'], name, { type: 'audio/mpeg' });
  Object.defineProperty(f, 'size', { value: 1000 });
  return f;
};

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  // No audio decoding in the test DOM: the length read gives up at once.
  vi.stubGlobal('Audio', undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('uploadSongXhr', () => {
  it('POSTs the file with title and artist from its name, and resolves with the track', async () => {
    const onProgress = vi.fn();
    const p = uploadSongXhr(file(), { onProgress, signal: new AbortController().signal });
    await sent();
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/uploads');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body!.get('title')).toBe('Neon Hearts');
    expect(xhr.body!.get('artist')).toBe('Night Riders');
    expect(xhr.body!.get('file')).toBeInstanceOf(File);
    xhr.answer(201, { track: { id: 'upload:x', title: 'Neon Hearts' } });
    await expect(p).resolves.toMatchObject({ id: 'upload:x' });
  });

  it('reports real byte progress, scaled from the multipart body to the file', async () => {
    const onProgress = vi.fn();
    void uploadSongXhr(file(), { onProgress, signal: new AbortController().signal }).catch(() => {});
    await sent();
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 600, total: 1200 });
    expect(onProgress).toHaveBeenLastCalledWith(500);
    FakeXhr.last.upload.onprogress!({ lengthComputable: false, loaded: 1, total: 0 });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('rejects with the server\'s own message (the hourly limit, too large)', async () => {
    const p = uploadSongXhr(file(), { onProgress: vi.fn(), signal: new AbortController().signal });
    await sent();
    FakeXhr.last.answer(429, { error: 'Slow down, try again in about 300s.' });
    await expect(p).rejects.toThrow('Slow down, try again in about 300s.');
  });

  it('says Connection lost on a network failure', async () => {
    const p = uploadSongXhr(file(), { onProgress: vi.fn(), signal: new AbortController().signal });
    await sent();
    FakeXhr.last.onerror!();
    await expect(p).rejects.toThrow('Connection lost');
  });

  it('a 401 ends the session like every other request', async () => {
    const p = uploadSongXhr(file(), { onProgress: vi.fn(), signal: new AbortController().signal });
    await sent();
    FakeXhr.last.answer(401, { error: 'Unauthorized' });
    await expect(p).rejects.toThrow('Unauthorized');
    expect(sessionExpired).toHaveBeenCalled();
  });

  it('aborts the request when the queue cancels it', async () => {
    const ctl = new AbortController();
    const p = uploadSongXhr(file(), { onProgress: vi.fn(), signal: ctl.signal });
    await sent();
    ctl.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(p).rejects.toThrow('Upload cancelled');
  });
});
