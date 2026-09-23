import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// M4: a runPython() timeout kills the child, which still fires 'close' with
// a non-zero/null code afterwards — SIGKILL doesn't skip that event. Before
// the fix, both the timeout handler and the close handler logged (and
// rejected) the same failure, so one real timeout showed up as two log
// lines. Kept isolated from youtube.test.ts, which owns its own
// auto-closing child_process mock.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let fakeChild: FakeChild;

vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => {
    fakeChild = new FakeChild();
    // No auto-close: this simulates a hung yt-dlp process that only exits
    // once runPython's timer kills it.
    return fakeChild;
  });
  return { spawn, default: { spawn } };
});

const loggedErrors: unknown[][] = [];
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: (...args: unknown[]) => loggedErrors.push(args), info: vi.fn(), warn: vi.fn() },
}));

describe('runPython timeout logging', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('logs the timeout exactly once, even though close fires afterward', async () => {
    loggedErrors.length = 0;
    vi.useFakeTimers();
    const { resolveStreamUrl } = await import('./youtube');

    const settled = resolveStreamUrl('AAAAAAAAAAA').catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(30000);
    // SIGKILL doesn't skip 'close' — the real child still reports its exit
    // after being killed, same as production.
    fakeChild.emit('close', null);
    await Promise.resolve();

    const err = await settled;
    expect((err as Error).message).toBe('python timed out');
    expect(loggedErrors).toHaveLength(1);
  });
});
