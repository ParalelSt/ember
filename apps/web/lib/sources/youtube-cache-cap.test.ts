import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// M5: URL_CACHE (resolved stream URLs) and LYRICS_CACHE were plain Maps with
// no size limit, keyed by an unbounded input — every distinct videoId /
// title+artist ever played, for the life of the process. This drives
// resolveStreamUrl well past URL_CACHE's cap with distinct ids, then asks
// for the very first id again: unbounded, it's still cached (no new spawn);
// capped, it was evicted long ago and gets resolved fresh.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let spawnCalls = 0;

vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => {
    spawnCalls++;
    const child = new FakeChild();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ url: 'https://example.com/no-expire' })));
      child.emit('close', 0);
    });
    return child;
  });
  return { spawn, default: { spawn } };
});

const id = (n: number) => `V${String(n).padStart(10, '0')}`;

describe('URL_CACHE stays bounded', () => {
  afterEach(() => {
    vi.clearAllMocks();
    spawnCalls = 0;
  });

  it('evicts old entries instead of growing without limit', async () => {
    const { resolveStreamUrl } = await import('./youtube');

    await resolveStreamUrl(id(0));

    // Push well past any reasonable cap with distinct, never-repeated ids.
    for (let i = 1; i <= 505; i++) {
      await resolveStreamUrl(id(i));
    }

    spawnCalls = 0;
    await resolveStreamUrl(id(0));
    expect(spawnCalls).toBe(1);
  });
});
