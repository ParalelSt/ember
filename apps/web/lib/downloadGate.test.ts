// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BusyError, createDownloadGate, isBusyError, maxConcurrentDownloads } from './downloadGate';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('downloadGate', () => {
  it('lets two run and makes the third wait for a release', async () => {
    const gate = createDownloadGate(2);
    const r1 = await gate.acquire();
    await gate.acquire();
    let third = false;
    void gate.acquire().then(() => { third = true; });
    await flush();
    expect(third).toBe(false);
    expect(gate.inFlightCount()).toBe(2);
    expect(gate.waitingCount()).toBe(1);
    r1();
    await flush();
    expect(third).toBe(true);
    expect(gate.inFlightCount()).toBe(2);
    expect(gate.waitingCount()).toBe(0);
  });

  it('wakes waiters in the order they arrived', async () => {
    const gate = createDownloadGate(1);
    const first = await gate.acquire();
    const order: string[] = [];
    const a = gate.acquire().then((r) => { order.push('a'); return r; });
    const b = gate.acquire().then((r) => { order.push('b'); return r; });
    first();
    (await a)();
    (await b)();
    expect(order).toEqual(['a', 'b']);
    expect(gate.inFlightCount()).toBe(0);
  });

  it('a release hands the slot to the waiter, so a fresh acquire cannot jump the queue', async () => {
    const gate = createDownloadGate(1);
    const first = await gate.acquire();
    const order: string[] = [];
    void gate.acquire().then(() => order.push('waiter'));
    first();
    void gate.acquire().then(() => order.push('late'));
    await flush();
    expect(order).toEqual(['waiter']);
  });

  it('tryAcquireIdle only succeeds when nothing runs and nobody waits', async () => {
    const gate = createDownloadGate(2);
    const idle = gate.tryAcquireIdle();
    expect(idle).not.toBeNull();
    // One prefetch running: a second prefetch is refused even though the cap is 2...
    expect(gate.tryAcquireIdle()).toBeNull();
    // ...while a listener's play still gets the free slot at once.
    const play = await gate.acquire();
    idle!();
    expect(gate.tryAcquireIdle()).toBeNull();
    play();
    const again = gate.tryAcquireIdle();
    expect(again).not.toBeNull();
    again!();
    expect(gate.inFlightCount()).toBe(0);
  });

  it('tryAcquireIdle is refused while someone is queued', async () => {
    const gate = createDownloadGate(1);
    const r = await gate.acquire();
    void gate.acquire();
    r();
    // The slot went to the waiter; the queue emptied, but the slot is busy.
    expect(gate.tryAcquireIdle()).toBeNull();
  });

  it('a double release frees only one slot', async () => {
    const gate = createDownloadGate(2);
    const r = await gate.acquire();
    await gate.acquire();
    r();
    r();
    expect(gate.inFlightCount()).toBe(1);
  });

  it('reads MAX_CONCURRENT_DOWNLOADS, defaulting to 2 on junk', () => {
    expect(maxConcurrentDownloads(undefined)).toBe(2);
    expect(maxConcurrentDownloads('')).toBe(2);
    expect(maxConcurrentDownloads('abc')).toBe(2);
    expect(maxConcurrentDownloads('0')).toBe(2);
    expect(maxConcurrentDownloads('1')).toBe(1);
    expect(maxConcurrentDownloads('4')).toBe(4);
    expect(maxConcurrentDownloads('3.7')).toBe(3);
  });

  it('BusyError carries 503 and the Retry-After seconds', () => {
    const e = new BusyError(30);
    expect(isBusyError(e)).toBe(true);
    expect(e.status).toBe(503);
    expect(e.retryAfter).toBe(30);
    expect(isBusyError(new Error('x'))).toBe(false);
  });

  it('a waiter that times out leaves the queue with a BusyError, and the slot goes to the next one', async () => {
    const gate = createDownloadGate(1);
    const first = await gate.acquire();
    const late = gate.acquire({ timeoutMs: 10 }).catch((e: unknown) => e);
    const patient = gate.acquire();
    expect(gate.waitingCount()).toBe(2);
    const err = await late;
    expect(isBusyError(err)).toBe(true);
    expect(gate.waitingCount()).toBe(1);
    first();
    (await patient)();
    expect(gate.inFlightCount()).toBe(0);
  });

  it('refuses straight away once maxWaiting callers wait', async () => {
    const gate = createDownloadGate(1);
    const first = await gate.acquire();
    const waiter = gate.acquire({ maxWaiting: 1 });
    await expect(gate.acquire({ maxWaiting: 1 })).rejects.toBeInstanceOf(BusyError);
    first();
    (await waiter)();
    expect(gate.inFlightCount()).toBe(0);
  });
});
