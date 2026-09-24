import { describe, expect, it } from 'vitest';
import table from './policy.cases.json';
import {
  POLICY,
  desiredIds,
  evictToFit,
  evictionOrder,
  nextAction,
  onResult,
  type FetchResult,
  type PolicyInput,
} from './policy';

/* The JSON table is the cross-platform contract, so it is decoded here the
 * same plain way the Kotlin and Rust suites decode it: defaults shallow-merged
 * with the case input, arrays to Sets, objects to Maps. */

type Json = Record<string, unknown>;

function toMap(v: unknown): Map<string, number> {
  return new Map(Object.entries((v ?? {}) as Record<string, number>));
}

function decodeInput(partial: Json): PolicyInput {
  const raw = { ...(table.defaults.input as Json), ...partial };
  return {
    ...(raw as unknown as PolicyInput),
    cached: new Set(raw.cached as string[]),
    sizes: toMap(raw.sizes),
    expectedBytes: toMap(raw.expectedBytes),
    backoffUntil: toMap(raw.backoffUntil),
    attempts: toMap(raw.attempts),
  };
}

function ledgerJson(l: { backoffUntil: Map<string, number>; attempts: Map<string, number>; drop: boolean }) {
  return {
    backoffUntil: Object.fromEntries(l.backoffUntil),
    attempts: Object.fromEntries(l.attempts),
    drop: l.drop,
  };
}

function base(partial: Partial<PolicyInput> = {}): PolicyInput {
  return { ...decodeInput({}), ...partial };
}

describe('case table: desiredIds + nextAction', () => {
  it.each(table.policy.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const input = decodeInput(c.input as Json);
    expect(desiredIds(input)).toEqual(c.expectedDesired);
    expect(nextAction(input)).toEqual(c.expectedAction);
  });
});

describe('case table: onResult', () => {
  it.each(table.onResult.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    let input = decodeInput(c.input as Json);
    for (const step of c.steps as Array<{ id: string; nowMs?: number; result: unknown; expected: unknown }>) {
      if (step.nowMs !== undefined) input = { ...input, nowMs: step.nowMs };
      const out = onResult(input, step.id, step.result as FetchResult);
      expect(ledgerJson(out)).toEqual(step.expected);
      input = { ...input, backoffUntil: out.backoffUntil, attempts: out.attempts };
    }
  });
});

describe('case table: evictionOrder', () => {
  it.each(table.evictionOrder.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(evictionOrder(decodeInput(c.input as Json), toMap(c.lastUsed))).toEqual(c.expected);
  });
});

describe('case table: evictToFit', () => {
  it.each(table.evictToFit.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(evictToFit(decodeInput(c.input as Json), toMap(c.lastUsed), c.incomingBytes)).toEqual(c.expected);
  });
});

describe('case table shape', () => {
  it('has unique case names so a failing mirror test points at one case', () => {
    const names = [...table.policy, ...table.onResult, ...table.evictionOrder, ...table.evictToFit].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every idle reason and both non-idle actions', () => {
    const kinds = new Set(
      table.policy.map((c) => {
        const a = c.expectedAction as { kind: string; reason?: string };
        return a.kind === 'idle' ? `idle:${a.reason}` : a.kind;
      }),
    );
    for (const k of [
      'start',
      'abort',
      'idle:disabled',
      'idle:offline',
      'idle:metered',
      'idle:battery',
      'idle:not-settled',
      'idle:busy',
      'idle:cap',
      'idle:nothing',
      'idle:backoff',
    ]) {
      expect(kinds, k).toContain(k);
    }
  });

  it('keeps the defaults input complete, so mirrors never guess a field', () => {
    expect(Object.keys(table.defaults.input).sort()).toEqual(
      [
        'attempts', 'backoffUntil', 'baseCount', 'batterySaver', 'bufferedToEnd', 'bytes', 'cached', 'cap',
        'context', 'enabled', 'allowMetered', 'expectedBytes', 'inFlight', 'index', 'loopMode', 'metered',
        'nowMs', 'online', 'playedSec', 'playing', 'queue', 'requestCurrent', 'saveData', 'sizes',
      ].sort(),
    );
  });
});

describe('POLICY numbers', () => {
  it('matches the plan', () => {
    expect(POLICY.N).toBe(2);
    expect(POLICY.MIN_PLAYED_SEC).toBe(15);
    expect(POLICY.BUFFER_FALLBACK_SEC).toBe(45);
    expect(POLICY.MAX_ATTEMPTS).toBe(3);
    expect(POLICY.BACKOFF_SEC).toEqual([15, 30, 60, 120]);
    expect(POLICY.RETRY_AFTER_CAP_SEC).toBe(120);
    expect(POLICY.BUSY_DEFAULT_SEC).toBe(30);
    expect(POLICY.EXPECTED_BYTES_DEFAULT).toBe(6 * 1024 * 1024);
  });
});

describe('onResult backoff', () => {
  it('walks the whole schedule and clamps past its end', () => {
    // Attempts beyond MAX_ATTEMPTS only happen if a driver ignores `drop`;
    // the schedule must still clamp rather than read past the array.
    let input = base({ nowMs: 0 });
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const out = onResult(input, 'youtube:c', { kind: 'failed' });
      waits.push((out.backoffUntil.get('youtube:c') ?? 0) - input.nowMs);
      input = { ...input, backoffUntil: out.backoffUntil, attempts: out.attempts };
    }
    expect(waits).toEqual([15000, 30000, 60000, 120000, 120000, 120000]);
  });

  it('never mutates the input ledger', () => {
    const backoffUntil = new Map([['youtube:c', 5]]);
    const attempts = new Map([['youtube:c', 1]]);
    const input = base({ backoffUntil, attempts });
    onResult(input, 'youtube:c', { kind: 'failed' });
    onResult(input, 'youtube:c', { kind: 'gone' });
    onResult(input, 'youtube:c', { kind: 'done', bytes: 1 });
    expect([...backoffUntil]).toEqual([['youtube:c', 5]]);
    expect([...attempts]).toEqual([['youtube:c', 1]]);
  });

  it('treats a non-finite Retry-After as absent', () => {
    const out = onResult(base(), 'youtube:c', { kind: 'retry-after', status: 503, seconds: Number.NaN });
    expect(out.backoffUntil.get('youtube:c')).toBe(base().nowMs + 30000);
  });

  it('keeps a dropped id out of nextAction once the ledger is fed back', () => {
    const input = base({ cached: new Set(['youtube:b']) });
    const out = onResult(input, 'youtube:c', { kind: 'gone' });
    expect(out.drop).toBe(true);
    const later = { ...input, attempts: out.attempts, backoffUntil: out.backoffUntil, nowMs: input.nowMs + 1e9 };
    expect(nextAction(later)).toEqual({ kind: 'start', id: 'youtube:d' });
  });

  it('a backoff wakes the policy at exactly the returned time', () => {
    const input = base({ cached: new Set(['youtube:b', 'youtube:d']) });
    const out = onResult(input, 'youtube:c', { kind: 'retry-after', status: 429, seconds: 7 });
    const fed = { ...input, attempts: out.attempts, backoffUntil: out.backoffUntil };
    const idle = nextAction(fed);
    expect(idle).toEqual({ kind: 'idle', reason: 'backoff', wakeAtMs: input.nowMs + 7000 });
    expect(nextAction({ ...fed, nowMs: input.nowMs + 6999 })).toEqual(idle);
    expect(nextAction({ ...fed, nowMs: input.nowMs + 7000 })).toEqual({ kind: 'start', id: 'youtube:c' });
  });
});

describe('eviction', () => {
  it('evictToFit only ever evicts a prefix of evictionOrder', () => {
    const input = base({
      cached: new Set(['youtube:b', 'youtube:x', 'youtube:y', 'youtube:z']),
      sizes: new Map([['youtube:b', 1], ['youtube:x', 3], ['youtube:y', 3], ['youtube:z', 3]]),
      bytes: 10,
      cap: 10,
    });
    const lastUsed = new Map([['youtube:x', 3], ['youtube:y', 1], ['youtube:z', 2]]);
    const order = evictionOrder(input, lastUsed);
    for (let incoming = 0; incoming <= 10; incoming++) {
      const r = evictToFit(input, lastUsed, incoming);
      if (r.fits) expect(order.slice(0, r.evict.length)).toEqual(r.evict);
      else expect(r.evict).toEqual([]);
    }
  });

  it('never offers the current track or the window, whatever lastUsed says', () => {
    const input = base({ cached: new Set(['youtube:a', 'youtube:b', 'youtube:c', 'youtube:d', 'youtube:e']) });
    const lastUsed = new Map([['youtube:b', -1], ['youtube:c', -1], ['youtube:d', -1]]);
    expect(evictionOrder(input, lastUsed)).toEqual(['youtube:a', 'youtube:e']);
  });

  it('nextAction and evictToFit agree: when a start fits by reclaimable room, eviction makes it fit', () => {
    const input = base({
      cached: new Set(['youtube:b', 'youtube:x', 'youtube:y']),
      sizes: new Map([['youtube:b', 5e6], ['youtube:x', 1e8], ['youtube:y', 1e8]]),
      bytes: 205e6,
      cap: 210e6,
    });
    const action = nextAction(input);
    expect(action).toEqual({ kind: 'start', id: 'youtube:c' });
    const r = evictToFit(input, new Map([['youtube:x', 2], ['youtube:y', 1]]), POLICY.EXPECTED_BYTES_DEFAULT);
    expect(r).toEqual({ evict: ['youtube:y'], fits: true });
  });
});

describe('desiredIds', () => {
  it('stays fast on a long queue full of dead tracks under loop-all', () => {
    const queue = Array.from({ length: 5000 }, (_, i) => ({
      id: `youtube:${i}`,
      streamUrl: `/s/${i}`,
      unavailableAt: i === 0 || i === 4999 ? null : '2026-09-01',
    }));
    const t0 = performance.now();
    const ids = desiredIds(base({ queue, index: 0, loopMode: 'all' }));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(ids).toEqual(['youtube:0', 'youtube:4999']);
  });

  it('stays linear when one live but unstreamable track sits among dead ones under loop-all', () => {
    // Every Next lands on the same live track, so without the landed-index
    // stop this would rescan the whole queue once per step.
    const queue = Array.from({ length: 20000 }, (_, i) => ({
      id: `youtube:${i}`,
      streamUrl: i === 7 ? null : `/s/${i}`,
      unavailableAt: i === 7 ? null : '2026-09-01',
    }));
    const t0 = performance.now();
    expect(desiredIds(base({ queue, index: 3, loopMode: 'all' }))).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('treats a NaN playedSec as not settled', () => {
    expect(nextAction(base({ playedSec: Number.NaN }))).toEqual({ kind: 'idle', reason: 'not-settled' });
  });
});
