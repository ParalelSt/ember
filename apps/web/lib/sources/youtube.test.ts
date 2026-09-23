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
