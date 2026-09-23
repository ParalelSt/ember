import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression test for a production bug: `GET /youtube/recommended?seed=-UaaeSP971U`
// returned a 502 because the seed was passed as `--seed <value>` and
// argparse in player.py read a hyphen-leading videoId as another option.
// YouTube ids legitimately start with `-`, so every place that builds
// player.py args from a track/user-supplied id must be immune to this.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let lastSpawnArgs: unknown[] | undefined;
let fakeChild: FakeChild;
/** What the next fake run prints: the empty list the player answers a
 *  search with. */
let nextStdout = '[]';
let nextStderr = '';
/** The next fake run's exit code. */
let nextCode = 0;

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: unknown[]) => {
    lastSpawnArgs = args;
    fakeChild = new FakeChild();
    // Resolve on the next tick so the caller's promise wiring is in place.
    queueMicrotask(() => {
      if (nextStderr) fakeChild.stderr.emit('data', Buffer.from(nextStderr));
      fakeChild.stdout.emit('data', Buffer.from(nextStdout));
      fakeChild.emit('close', nextCode);
    });
    return fakeChild;
  });
  return { spawn, default: { spawn } };
});

describe('getRecommended', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes a hyphen-leading seed as --seed=<id>, never as a separate argv token', async () => {
    const { getRecommended } = await import('./youtube');
    await getRecommended({ seed: '-UaaeSP971U', country: 'ZZ', limit: 30 });

    expect(lastSpawnArgs).toBeDefined();
    // args[0] is the player.py script path; the rest is the command line.
    const args = lastSpawnArgs as string[];
    expect(args).toContain('--seed=-UaaeSP971U');
    expect(args).not.toContain('--seed');
    expect(args).toEqual([
      expect.stringContaining('player.py'),
      'recommended',
      '--country',
      'ZZ',
      '--limit',
      '30',
      '--seed=-UaaeSP971U',
    ]);
  });

  it('still passes an ordinary seed correctly', async () => {
    const { getRecommended } = await import('./youtube');
    await getRecommended({ seed: 'dQw4w9WgXcQ', country: 'US', limit: 10 });

    const args = lastSpawnArgs as string[];
    expect(args).toContain('--seed=dQw4w9WgXcQ');
  });

  it('omits --seed entirely when no seed is given', async () => {
    const { getRecommended } = await import('./youtube');
    await getRecommended({ country: 'US', limit: 10 });

    const args = lastSpawnArgs as string[];
    expect(args.some((a) => String(a).startsWith('--seed'))).toBe(false);
  });
});

// Anything the helper writes to stderr reaches the terminal and the server
// log, so a credential in it must not.
describe('runPython stderr', () => {
  afterEach(() => {
    vi.clearAllMocks();
    nextStdout = '[]';
    nextStderr = '';
  });

  it('redacts a credential that somehow reached the helper stderr', async () => {
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    nextStderr = `recommended: giving up\ncookie: SAPISID=s3cr3tSAPISID\n`;
    try {
      const { getRecommended } = await import('./youtube');
      await getRecommended({ seed: 'dQw4w9WgXcQ', country: 'US', limit: 10 });
    } finally {
      process.stderr.write = realWrite;
    }
    expect(written.join('')).not.toContain('s3cr3tSAPISID');
    expect(written.join('')).toContain('[redacted]');
  });
});

// YouTube's rate limit reads "Video unavailable" too. Treating it as a dead
// video greyed out every song tried during the limit, for everyone, for good.
describe('yt-dlp failure classification', () => {
  // yt-dlp 2026.08.19 (extractor/youtube/_video.py), verbatim.
  const RATE_LIMITED =
    "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This content isn't available, try again later. " +
    'The current session has been rate-limited by YouTube for up to an hour. It is recommended to use ' +
    '`-t sleep` to add a delay between video requests to avoid exceeding the rate limit. For more ' +
    'information, refer to  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#this-content-isnt-available-try-again-later';
  const ACCOUNT_RATE_LIMITED = RATE_LIMITED.replace('The current session', 'Your account');

  afterEach(() => {
    vi.clearAllMocks();
    nextStdout = '[]';
    nextStderr = '';
    nextCode = 0;
  });

  it('treats the rate-limit message as transient, not unavailable', async () => {
    const { classifyYtdlpFailure } = await import('./youtube');
    expect(classifyYtdlpFailure(RATE_LIMITED.replace(/^ERROR: /, ''))).toBeNull();
    expect(classifyYtdlpFailure(ACCOUNT_RATE_LIMITED.replace(/^ERROR: /, ''))).toBeNull();
  });

  it('a rate-limited stream resolve is a 502, never a 410', async () => {
    nextStdout = '';
    nextStderr = `Traceback (most recent call last):\n  ...\n${RATE_LIMITED}\n`;
    nextCode = 1;
    const { resolveStreamUrl, isUnavailableError } = await import('./youtube');
    const err = await resolveStreamUrl('dQw4w9WgXcQ').catch((e: unknown) => e);
    expect(isUnavailableError(err)).toBe(false);
    expect((err as { status?: number }).status).toBe(502);
  });

  it('still marks a genuinely removed video unavailable', async () => {
    const { classifyYtdlpFailure } = await import('./youtube');
    expect(classifyYtdlpFailure('[youtube] dQw4w9WgXcQ: Video unavailable')).toBe('unavailable');
    expect(classifyYtdlpFailure('[youtube] dQw4w9WgXcQ: Video unavailable. This video has been removed by the uploader')).toBe('removed');
  });
});

// "Nothing found" was cached for 5 minutes, so a moment when search could
// not answer kept showing no results long after it recovered.
describe('searchTracks cache', () => {
  afterEach(() => {
    vi.clearAllMocks();
    nextStdout = '[]';
    nextStderr = '';
    nextCode = 0;
  });

  it('does not cache an empty answer', async () => {
    const { spawn } = await import('node:child_process');
    const { searchTracks } = await import('./youtube');
    nextStdout = '[]';
    expect(await searchTracks('s03 empty query')).toEqual([]);
    nextStdout = JSON.stringify([{ videoId: 'dQw4w9WgXcQ', title: 'Back', artist: 'Band', durationSec: 200 }]);
    const again = await searchTracks('s03 empty query');
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    expect(again.map((t) => t.title)).toEqual(['Back']);
  });

  it('still caches a real answer', async () => {
    const { spawn } = await import('node:child_process');
    const { searchTracks } = await import('./youtube');
    nextStdout = JSON.stringify([{ videoId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Band', durationSec: 200 }]);
    await searchTracks('s03 cached query');
    await searchTracks('s03 cached query');
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });

  it('a failed search is an error, not an empty list', async () => {
    const { searchTracks } = await import('./youtube');
    nextStdout = '';
    nextStderr = 'ERROR: search: could not reach YouTube Music or YouTube\n';
    nextCode = 1;
    await expect(searchTracks('s03 failing query')).rejects.toMatchObject({ status: 502 });
  });
});

// Album and artist failures used to hand the browser ytmusicapi's whole
// 1.5 KB response dump, and a missing album was a 502 instead of a 404.
describe('album and artist errors', () => {
  const DUMP =
    "\"Unable to find 'contents' using path ['contents', 'twoColumnBrowseResultsRenderer'] on " +
    "{'responseContext': {'serviceTrackingParams': []}}, exception: 'contents'\"";

  afterEach(() => {
    vi.clearAllMocks();
    nextStdout = '[]';
  });

  it('a missing album is a short 404', async () => {
    nextStdout = JSON.stringify({ error: 'Album not found', reason: 'not-found' });
    const { getAlbum } = await import('./youtube');
    const err = (await getAlbum('MPREb_zzzzzzzzzzz').catch((e: unknown) => e)) as Error & { status?: number };
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('responseContext');
  });

  it('a missing artist is a short 404', async () => {
    nextStdout = JSON.stringify({ error: 'Artist not found', reason: 'not-found' });
    const { getArtist } = await import('./youtube');
    const err = (await getArtist('UCzzzzzzzzzzzzzzzzzzzzzz').catch((e: unknown) => e)) as Error & { status?: number };
    expect(err.status).toBe(404);
  });

  it('never passes a raw helper dump to the browser', async () => {
    nextStdout = JSON.stringify({ error: DUMP });
    const { getAlbum, getArtist } = await import('./youtube');
    for (const call of [() => getAlbum('MPREb_zzzzzzzzzzz'), () => getArtist('UCzzzzzzzzzzzzzzzzzzzzzz')]) {
      const err = (await call().catch((e: unknown) => e)) as Error & { status?: number };
      expect(err.status).toBe(502);
      expect(err.message).not.toContain('responseContext');
      expect(err.message).not.toContain('Unable to find');
    }
  });
});
