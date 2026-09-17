import { describe, expect, it, vi } from 'vitest';
import { createCrashHandlers } from './crashHandlers';

function setup() {
  const log = vi.fn();
  const spawnReport = vi.fn();
  const exit = vi.fn();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const setTimer = (fn: () => void, ms: number) => timers.push({ fn, ms });
  const handlers = createCrashHandlers({ log, spawnReport, exit, setTimer });
  const flush = () => timers.splice(0).forEach((t) => t.fn());
  return { log, spawnReport, exit, timers, handlers, flush };
}

describe('crash handlers', () => {
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

  it('exits with 1 after the flush delay on an uncaught exception, once', () => {
    const { exit, timers, handlers, flush } = setup();
    handlers.onUncaughtException(new Error('a'));
    handlers.onUncaughtException(new Error('b'));
    expect(exit).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(500);
    flush();
    expect(exit).toHaveBeenCalledWith(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('logs and reports an unhandled rejection without exiting', () => {
    const { log, spawnReport, exit, timers, handlers } = setup();
    handlers.onUnhandledRejection('plain string reason');
    expect(log).toHaveBeenCalledWith(
      'crash',
      'unhandledRejection: plain string reason',
      undefined,
      expect.any(Error),
    );
    expect(spawnReport).toHaveBeenCalledWith('Server error: plain string reason', expect.stringContaining('unhandledRejection'));
    expect(timers).toHaveLength(0);
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

  it('still exits when logging and spawning both throw', () => {
    const exit = vi.fn();
    const timers: Array<() => void> = [];
    const handlers = createCrashHandlers({
      log: () => {
        throw new Error('disk full');
      },
      spawnReport: () => {
        throw new Error('spawn EAGAIN');
      },
      exit,
      setTimer: (fn) => timers.push(fn),
    });
    expect(() => handlers.onUncaughtException(new Error('boom'))).not.toThrow();
    timers.forEach((fn) => fn());
    expect(exit).toHaveBeenCalledWith(1);
  });
});
