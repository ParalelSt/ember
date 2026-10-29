import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A helper that cannot even start (the venv's python missing after a broken
// update): Node emits 'error' and then 'close' for the same failed spawn.
// Both used to log and reject, and the browser got Node's raw
// "spawn /abs/path/.venv/bin/python ENOENT", a server path, as the message.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let fakeChild: FakeChild;

vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => {
    fakeChild = new FakeChild();
    return fakeChild;
  });
  return { spawn, default: { spawn } };
});

const loggedErrors: unknown[][] = [];
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: (...args: unknown[]) => loggedErrors.push(args), info: vi.fn(), warn: vi.fn() },
}));

describe('runPython when the helper cannot start', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails once, with a sentence instead of the server path', async () => {
    loggedErrors.length = 0;
    const { resolveStreamUrl } = await import('./youtube');

    const settled = resolveStreamUrl('BBBBBBBBBBB').catch((e: Error & { status?: number }) => e);
    await Promise.resolve();
    const enoent = Object.assign(new Error('spawn /home/owner/ember/.venv/bin/python ENOENT'), { code: 'ENOENT' });
    fakeChild.emit('error', enoent);
    fakeChild.emit('close', -2);

    const err = (await settled) as Error & { status?: number };
    expect(err.message).not.toContain('/home/owner');
    expect(err.message).toMatch(/could not start/);
    expect(err.status).toBe(502);
    expect(loggedErrors).toHaveLength(1);
  });
});
