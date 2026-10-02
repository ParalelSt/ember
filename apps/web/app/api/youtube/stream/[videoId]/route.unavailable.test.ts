// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NOT_AVAILABLE_ID, YTDLP_NOT_AVAILABLE_STDERR } from '@/test-utils/ytdlpStderr';

// The report (2026-09-30): radio queued 0LYiIUMeO1o, which YouTube Music
// still lists but yt-dlp refuses with "This video is not available", and the
// host's log showed that one id downloaded two to four times. Here the real
// route, the real lib/sources/youtube (spawn, stderr parsing, classifying)
// and the real memory run against a fake player.py that prints what the real
// one printed for that id. Only the database, the session and the logger are
// stand-ins.

const OK_ID = 'okvideo0001';
const GLITCH_ID = 'glitchy0001';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

/** Every player.py run, as its command line (after the script path). */
const runs: string[][] = [];
const downloads = (id: string) => runs.filter((a) => a[0] === 'download' && a.includes(id)).length;
const lookups = (id: string) => runs.filter((a) => a[0] === 'info' && a.includes(id)).length;

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, argv: string[]) => {
    const args = argv.slice(1);
    runs.push(args);
    const child = new FakeChild();
    queueMicrotask(() => {
      const [command] = args;
      const id = args[args.length - 1];
      if ((command === 'download' || command === 'info') && id === NOT_AVAILABLE_ID) {
        child.stderr.emit('data', Buffer.from(YTDLP_NOT_AVAILABLE_STDERR));
        child.emit('close', 1);
      } else if ((command === 'download' || command === 'info') && id === GLITCH_ID) {
        child.stderr.emit('data', Buffer.from('ERROR: unable to download video data: HTTP Error 403: Forbidden\n'));
        child.emit('close', 1);
      } else if (command === 'recommended') {
        const track = (videoId: string, title: string) => ({ videoId, title, artist: 'A', artworkUrl: '' });
        child.stdout.emit('data', Buffer.from(JSON.stringify([track(NOT_AVAILABLE_ID, 'Gone'), track(OK_ID, 'Fine')])));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from(`unexpected ${args.join(' ')}`));
        child.emit('close', 1);
      }
    });
    return child;
  });
  return { spawn, default: { spawn } };
});

/** The tracks table: the song's row, when somebody has saved it. */
const db = { hasRow: false, mark: null as { reason: string; at: number } | null };
const markTrackUnavailable = vi.fn(async (_id: string, reason: string) => {
  if (db.hasRow) db.mark = { reason, at: Date.now() };
});
vi.mock('@/lib/trackAvailability', () => ({
  markTrackUnavailable: (id: string, reason: string) => markTrackUnavailable(id, reason),
  clearTrackUnavailable: vi.fn(),
  listUnavailableIds: async () => new Set(db.mark ? [`youtube:${NOT_AVAILABLE_ID}`] : []),
  freshUnavailableMark: async (id: string) => (db.mark && id === `youtube:${NOT_AVAILABLE_ID}` ? db.mark : null),
}));

const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: logs }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/streamCache', () => ({ queueCacheWarm: vi.fn() }));

const availabilityRow = { value: null as null | { unavailable_at?: string; unavailable_reason?: string } };
vi.mock('@/lib/auth', () => ({
  verifiedUserId: async () => 'member-1',
  requireUser: async () => ({
    user: { id: 'member-1' },
    pb: {
      collection: () => ({
        getFirstListItem: async () => {
          if (!availabilityRow.value) throw Object.assign(new Error('not found'), { status: 404 });
          return availabilityRow.value;
        },
      }),
    },
  }),
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => new Response(null, { status: 401 }),
}));

const { GET } = await import('./route');
const { GET: AVAILABILITY } = await import('../../../tracks/[id]/availability/route');
const { GET: RECOMMENDED } = await import('../../recommended/route');
const { _resetFailureMemo, TRANSIENT_MEMO_MS } = await import('@/lib/sources/failureMemo');
const { _resetBuckets } = await import('@/lib/rateLimit');

let seq = 0;
function stream(videoId: string, { prefetch = false, retry = false } = {}) {
  seq += 1;
  const query = prefetch ? '?prefetch=1' : retry ? '?retry=1' : '';
  const req = new NextRequest(`http://localhost/api/youtube/stream/${videoId}${query}`, {
    headers: { 'x-forwarded-for': `10.9.0.${seq % 250}`, range: 'bytes=0-' },
  });
  return GET(req, { params: Promise.resolve({ videoId }) } as never);
}
async function availability(id: string) {
  const res = await AVAILABILITY(new NextRequest(`http://localhost/api/tracks/${id}/availability`), { params: Promise.resolve({ id }) } as never);
  return res.json();
}

beforeEach(() => {
  runs.length = 0;
  db.hasRow = false;
  db.mark = null;
  availabilityRow.value = null;
  _resetFailureMemo();
  _resetBuckets();
  markTrackUnavailable.mockClear();
  logs.error.mockClear();
  logs.warn.mockClear();
  logs.info.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('a radio song YouTube refuses ("This video is not available")', () => {
  it('prefetch, play and three player retries run yt-dlp once, all answered 410 with the reason', async () => {
    const answers = [
      await stream(NOT_AVAILABLE_ID, { prefetch: true }),
      await stream(NOT_AVAILABLE_ID),
      await stream(NOT_AVAILABLE_ID),
      await stream(NOT_AVAILABLE_ID),
      await stream(NOT_AVAILABLE_ID),
    ];
    expect(answers.map((r) => r.status)).toEqual([410, 410, 410, 410, 410]);
    expect(await answers[1].json()).toMatchObject({ unavailable: true, reason: 'unavailable' });
    // Never from the browser's cache: the host must hear every ask to say why.
    expect(answers.map((r) => r.headers.get('cache-control'))).toEqual(Array(5).fill('no-store'));
    expect(downloads(NOT_AVAILABLE_ID)).toBe(1);
    // Never a live-stream attempt either: a removed video has none.
    expect(lookups(NOT_AVAILABLE_ID)).toBe(0);
  });

  it('is an expected answer in the log (info), not an error the digest counts', async () => {
    await stream(NOT_AVAILABLE_ID);
    await stream(NOT_AVAILABLE_ID);
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.info).toHaveBeenCalledWith('python', 'video unavailable on YouTube', expect.objectContaining({ reason: 'unavailable' }));
  });

  it('with no saved row, the availability check still knows why (the radio case)', async () => {
    await stream(NOT_AVAILABLE_ID);
    expect(await availability(`youtube:${NOT_AVAILABLE_ID}`)).toEqual({ unavailable: true, reason: 'unavailable' });
    expect(await availability(`youtube:${OK_ID}`)).toEqual({ unavailable: false, reason: null });
  });

  it('radio never offers it again', async () => {
    await stream(NOT_AVAILABLE_ID);
    const res = await RECOMMENDED(new NextRequest(`http://localhost/api/youtube/recommended?seed=${OK_ID}`, { headers: { 'x-forwarded-for': '10.9.9.9' } }), {} as never);
    const { tracks } = await res.json();
    expect(tracks.map((t: { id: string }) => t.id)).toEqual([`youtube:${OK_ID}`]);
  });

  it('a song flagged in the database answers 410 at once, even in a fresh process', async () => {
    db.hasRow = true;
    db.mark = { reason: 'removed', at: Date.now() - 60_000 };
    const res = await stream(NOT_AVAILABLE_ID);
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ unavailable: true, reason: 'removed' });
    expect(runs).toHaveLength(0);
  });

  it('flags the saved row for everyone', async () => {
    db.hasRow = true;
    await stream(NOT_AVAILABLE_ID);
    expect(markTrackUnavailable).toHaveBeenCalledWith(`youtube:${NOT_AVAILABLE_ID}`, 'unavailable');
    expect(db.mark?.reason).toBe('unavailable');
  });

  it('a known dead song does not spend the member\'s new-song budget', async () => {
    await stream(NOT_AVAILABLE_ID);
    for (let i = 0; i < 70; i++) expect((await stream(NOT_AVAILABLE_ID)).status).toBe(410);
    expect(downloads(NOT_AVAILABLE_ID)).toBe(1);
  });
});

describe('a song that fails for a passing reason (403)', () => {
  it('is tried once, then answered 502 at once for two minutes, then tried again', async () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const first = await stream(GLITCH_ID);
    expect(first.status).toBe(502);
    // The download and the live-stream fallback both ran, once.
    expect(downloads(GLITCH_ID)).toBe(1);
    expect(lookups(GLITCH_ID)).toBe(1);

    const retry = await stream(GLITCH_ID);
    expect(retry.status).toBe(502);
    expect(await retry.json()).toMatchObject({ cause: 'stream-failed', recent: true });
    expect(Number(retry.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(downloads(GLITCH_ID)).toBe(1);
    expect(await availability(`youtube:${GLITCH_ID}`)).toEqual({ unavailable: false, reason: null, transient: true });

    now.mockReturnValue(t0 + TRANSIENT_MEMO_MS + 1);
    await stream(GLITCH_ID);
    expect(downloads(GLITCH_ID)).toBe(2);
  });

  it("the listener's own retry (Tap to retry) gets a real attempt within the two minutes", async () => {
    expect((await stream(GLITCH_ID)).status).toBe(502);
    expect(downloads(GLITCH_ID)).toBe(1);
    const tapped = await stream(GLITCH_ID, { retry: true });
    expect(tapped.status).toBe(502);
    expect(await tapped.json()).not.toHaveProperty('recent');
    expect(downloads(GLITCH_ID)).toBe(2);
  });

  it('a retry of a song YouTube says is gone is still answered from memory', async () => {
    await stream(NOT_AVAILABLE_ID);
    expect((await stream(NOT_AVAILABLE_ID, { retry: true })).status).toBe(410);
    expect(downloads(NOT_AVAILABLE_ID)).toBe(1);
  });

  it('stays an error in the log: a 403 is a real problem', async () => {
    await stream(GLITCH_ID);
    expect(logs.error).toHaveBeenCalled();
  });

  it('is never flagged unavailable', async () => {
    db.hasRow = true;
    await stream(GLITCH_ID);
    expect(markTrackUnavailable).not.toHaveBeenCalled();
  });
});
