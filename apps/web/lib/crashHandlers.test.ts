import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCrashHandlers } from './crashHandlers';

function setup() {
  const log = vi.fn();
  const spawnReport = vi.fn();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const handlers = createCrashHandlers({ log, spawnReport });
  return { log, spawnReport, exit, handlers };
}

describe('crash handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('logs an uncaught exception with its stack', () => {
    const { log, handlers } = setup();
    const err = new Error('boom');
    handlers.onUncaughtException(err);
    expect(log).toHaveBeenCalledWith('crash', 'uncaughtException: boom', undefined, err);
  });

  it('spawns the poster with a short title and the stack as text', () => {
    const { spawnReport, handlers } = setup();
    const err = new Error('x'.repeat(150));
    handlers.onUncaughtException(err);
    expect(spawnReport).toHaveBeenCalledTimes(1);
    const [title, text] = spawnReport.mock.calls[0];
    expect(title).toBe(`Server error: ${'x'.repeat(100)}`);
    expect(text).toContain('uncaughtException');
    expect(text).toContain(err.stack);
  });

  it('keeps the process running after an uncaught exception', async () => {
    vi.useFakeTimers();
    const { exit, handlers } = setup();
    handlers.onUncaughtException(new Error('a'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs and reports an unhandled rejection without exiting', () => {
    const { log, spawnReport, exit, handlers } = setup();
    handlers.onUnhandledRejection('plain string reason');
    expect(log).toHaveBeenCalledWith(
      'crash',
      'unhandledRejection: plain string reason',
      undefined,
      expect.any(Error),
    );
    expect(spawnReport).toHaveBeenCalledWith('Server error: plain string reason', expect.stringContaining('unhandledRejection'));
    expect(exit).not.toHaveBeenCalled();
  });

  it('posts once per distinct message, but logs every occurrence', () => {
    const { log, spawnReport, handlers } = setup();
    handlers.onUnhandledRejection(new Error('same'));
    handlers.onUnhandledRejection(new Error('same'));
    handlers.onUncaughtException(new Error('same'));
    handlers.onUnhandledRejection(new Error('different'));
    expect(log).toHaveBeenCalledTimes(4);
    expect(spawnReport).toHaveBeenCalledTimes(2);
    expect(spawnReport.mock.calls.map((c) => c[0])).toEqual(['Server error: same', 'Server error: different']);
  });

  it('never throws when logging and spawning both fail', () => {
    const handlers = createCrashHandlers({
      log: () => {
        throw new Error('disk full');
      },
      spawnReport: () => {
        throw new Error('spawn EAGAIN');
      },
    });
    expect(() => handlers.onUncaughtException(new Error('boom'))).not.toThrow();
    expect(() => handlers.onUnhandledRejection(new Error('boom'))).not.toThrow();
  });
});
