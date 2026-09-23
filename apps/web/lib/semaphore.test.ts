// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusyError, createSemaphore } from './semaphore';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSemaphore', () => {
  it('never runs more than max jobs at once', async () => {
    const sem = createSemaphore(4, { queueTimeoutMs: 10_000 });
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 12 }, () => deferred());
    const jobs = gates.map((g) => sem.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await g.promise;
      running -= 1;
    }));
    await settle();
    expect(sem.active).toBe(4);
    expect(sem.waiting).toBe(8);
    for (const g of gates) { g.resolve(); await settle(); }
    await Promise.all(jobs);
    expect(peak).toBe(4);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it('runs waiting jobs in arrival order', async () => {
    const sem = createSemaphore(1, { queueTimeoutMs: 10_000 });
    const order: number[] = [];
    const gate = deferred();
    const first = sem.run(() => gate.promise);
    const rest = [1, 2, 3].map((n) => sem.run(async () => { order.push(n); }));
    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a job that waits past the queue timeout fails with a 503 and never runs', async () => {
    vi.useFakeTimers();
    const sem = createSemaphore(1, { queueTimeoutMs: 1_000 });
    const gate = deferred();
    const holder = sem.run(() => gate.promise);
    const fn = vi.fn(async () => 'ran');
    const late = sem.run(fn).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_001);
    const err = await late;
    expect(err).toBeInstanceOf(BusyError);
    expect((err as BusyError).status).toBe(503);
    expect(sem.waiting).toBe(0);
    gate.resolve();
    await holder;
    expect(fn).not.toHaveBeenCalled();
    // The timed-out waiter left no ghost slot behind.
    expect(sem.active).toBe(0);
    await expect(sem.run(async () => 'next')).resolves.toBe('next');
  });

  it('a throwing job releases its slot', async () => {
    const sem = createSemaphore(1, { queueTimeoutMs: 10_000 });
    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(sem.active).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('many failures and timeouts in a row leak no slots', async () => {
    vi.useFakeTimers();
    const sem = createSemaphore(2, { queueTimeoutMs: 100 });
    const gate = deferred();
    const holders = [sem.run(() => gate.promise), sem.run(() => gate.promise)];
    const late = Array.from({ length: 20 }, () => sem.run(async () => 'x').catch(() => 'timed out'));
    await vi.advanceTimersByTimeAsync(101);
    expect(await Promise.all(late)).toEqual(Array(20).fill('timed out'));
    gate.reject(new Error('fail'));
    await Promise.allSettled(holders);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
    vi.useRealTimers();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => sem.run(async () => i)));
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('a full queue refuses straight away', async () => {
    const sem = createSemaphore(1, { queueTimeoutMs: 10_000, maxQueue: 2 });
    const gate = deferred();
    const holder = sem.run(() => gate.promise);
    const waiting = [sem.run(async () => 1), sem.run(async () => 2)];
    await expect(sem.run(async () => 3)).rejects.toBeInstanceOf(BusyError);
    gate.resolve();
    await holder;
    await expect(Promise.all(waiting)).resolves.toEqual([1, 2]);
  });
});
