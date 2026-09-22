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
  // Whatever a caller writes to the child's stdin, kept so a test can prove
  // the credentials went that way and not into argv.
  stdin = { end: vi.fn((text?: string) => { stdinWrites.push(text ?? ''); }), on: vi.fn() };
  kill = vi.fn();
}

let lastSpawnArgs: unknown[] | undefined;
let fakeChild: FakeChild;
const stdinWrites: string[] = [];
/** What the next fake run prints. Every test but the liked ones wants the
 *  empty list the player answers a search with. */
let nextStdout = '[]';
let nextStderr = '';

vi.mock('node:child_process', () => {
  const spawn = vi.fn((_cmd: string, args: unknown[]) => {
    lastSpawnArgs = args;
    fakeChild = new FakeChild();
    // Resolve on the next tick so the caller's promise wiring is in place.
    queueMicrotask(() => {
      if (nextStderr) fakeChild.stderr.emit('data', Buffer.from(nextStderr));
      fakeChild.stdout.emit('data', Buffer.from(nextStdout));
      fakeChild.emit('close', 0);
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

// The transfer of somebody's own YouTube Music likes. The rule being tested
// is the one that matters: the pasted headers reach the helper on stdin and
// appear nowhere else.
const HEADERS = [
  'accept: */*',
  'authorization: SAPISIDHASH 1758500000_s3cr3thash',
  'cookie: SAPISID=s3cr3tSAPISID; __Secure-3PAPISID=s3cr3t3PAPISID',
  'x-goog-authuser: 0',
].join('\n');

const likedSong = (videoId: string, title: string) => ({
  videoId,
  title,
  artists: ['Artist One', 'Artist Two'],
  artistId: 'UCartist',
  album: 'An Album',
  durationSec: 202,
  artworkUrl: 'https://lh3.example/large',
  likedAt: null,
  setVideoId: `set-${videoId}`,
});

describe('fetchLikedSongs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    stdinWrites.length = 0;
    nextStdout = '[]';
    nextStderr = '';
  });

  it('passes the headers on stdin and never in argv', async () => {
    nextStdout = JSON.stringify({ items: [likedSong('aaaaaaaaaaa', 'First')], count: 1, truncated: false });
    const { fetchLikedSongs } = await import('./youtube');
    await fetchLikedSongs(HEADERS);

    expect(lastSpawnArgs).toEqual([expect.stringContaining('player.py'), 'liked', '--auth-stdin']);
    expect(JSON.stringify(lastSpawnArgs)).not.toContain('s3cr3t');
    expect(stdinWrites).toEqual([HEADERS]);
  });

  it('turns the answer into tracks that need no search', async () => {
    nextStdout = JSON.stringify({
      items: [likedSong('aaaaaaaaaaa', 'First'), likedSong('bbbbbbbbbbb', 'Second')],
      count: 2,
      truncated: false,
    });
    const { fetchLikedSongs } = await import('./youtube');
    const { songs, truncated } = await fetchLikedSongs(HEADERS);

    expect(truncated).toBe(false);
    expect(songs).toHaveLength(2);
    expect(songs[0].track).toMatchObject({
      id: 'youtube:aaaaaaaaaaa',
      sourceId: 'aaaaaaaaaaa',
      source: 'youtube',
      title: 'First',
      artist: 'Artist One',
      album: 'An Album',
      durationSec: 202,
    });
    expect(songs[0].artists).toEqual(['Artist One', 'Artist Two']);
    expect(songs[0].likedAt).toBeNull();
  });

  it('drops rows with no usable video and keeps the first of a duplicate', async () => {
    nextStdout = JSON.stringify({
      items: [
        likedSong('aaaaaaaaaaa', 'First'),
        { ...likedSong('aaaaaaaaaaa', 'First again'), setVideoId: 'other' },
        likedSong('not-an-id', 'Nonsense'),
        { title: 'No video at all' },
      ],
      count: 4,
      truncated: false,
    });
    const { fetchLikedSongs } = await import('./youtube');
    const { songs } = await fetchLikedSongs(HEADERS);
    expect(songs.map((s) => s.track.sourceId)).toEqual(['aaaaaaaaaaa']);
    expect(songs[0].track.title).toBe('First');
  });

  it('carries the truncation flag through', async () => {
    nextStdout = JSON.stringify({ items: [likedSong('aaaaaaaaaaa', 'First')], count: 1, truncated: true });
    const { fetchLikedSongs } = await import('./youtube');
    expect((await fetchLikedSongs(HEADERS)).truncated).toBe(true);
  });

  it("makes the helper's auth refusal a 401 with its sentence", async () => {
    nextStdout = JSON.stringify({ error: 'Ember could not read your YouTube Music library.', kind: 'auth' });
    const { fetchLikedSongs } = await import('./youtube');
    await expect(fetchLikedSongs(HEADERS)).rejects.toMatchObject({
      status: 401,
      message: 'Ember could not read your YouTube Music library.',
    });
  });

  it('makes YouTube Music being down a 502', async () => {
    nextStdout = JSON.stringify({ error: 'YouTube Music did not answer.', kind: 'network' });
    const { fetchLikedSongs } = await import('./youtube');
    await expect(fetchLikedSongs(HEADERS)).rejects.toMatchObject({ status: 502 });
  });

  it('redacts a credential that somehow reached the helper stderr', async () => {
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    nextStderr = `liked: giving up\ncookie: SAPISID=s3cr3tSAPISID\n`;
    nextStdout = JSON.stringify({ items: [], count: 0, truncated: false });
    try {
      const { fetchLikedSongs } = await import('./youtube');
      await fetchLikedSongs(HEADERS);
    } finally {
      process.stderr.write = realWrite;
    }
    expect(written.join('')).not.toContain('s3cr3tSAPISID');
    expect(written.join('')).toContain('[redacted]');
  });
});
