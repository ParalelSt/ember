import { describe, expect, it } from 'vitest';
import { noneAdapter, parseRetryAfter, resultForStatus, withPrefetchParam } from './adapter';
import { effectivePlayedSec, expectedBytesFor } from './driver';
import { POLICY } from './policy';

describe('withPrefetchParam', () => {
  it('adds the marker, keeping an existing query', () => {
    expect(withPrefetchParam('/api/uploads/u1/stream')).toBe('/api/uploads/u1/stream?prefetch=1');
    expect(withPrefetchParam('http://h/s?x=1')).toBe('http://h/s?x=1&prefetch=1');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, null otherwise', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(' 7 ')).toBe(7);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('resultForStatus', () => {
  it('maps the stream route answers the policy knows', () => {
    expect(resultForStatus(429, '12')).toEqual({ kind: 'retry-after', status: 429, seconds: 12 });
    expect(resultForStatus(503, null)).toEqual({ kind: 'retry-after', status: 503, seconds: null });
    expect(resultForStatus(410, null)).toEqual({ kind: 'gone' });
    expect(resultForStatus(502, null)).toEqual({ kind: 'failed' });
    expect(resultForStatus(401, null)).toEqual({ kind: 'failed' });
    expect(resultForStatus(200, null)).toBeNull();
    expect(resultForStatus(206, null)).toBeNull();
  });
});

describe('noneAdapter', () => {
  it('caches nothing and is never ready', async () => {
    expect(await noneAdapter.ready()).toBe(false);
    expect(noneAdapter.has('x')).toBe(false);
    expect(noneAdapter.localSrcFor('x')).toBeNull();
    expect(noneAdapter.stats()).toEqual({ bytes: 0, count: 0, cap: 0 });
  });
});

describe('driver helpers', () => {
  it('estimates 20 kB a second, unknown without a duration', () => {
    expect(expectedBytesFor({ durationSec: 180 })).toBe(3_600_000);
    expect(expectedBytesFor({ durationSec: 0 })).toBeUndefined();
    expect(expectedBytesFor(undefined)).toBeUndefined();
  });

  it('test overrides move the play-time gates without touching the policy', () => {
    const o = { minPlayedSec: 2, bufferFallbackSec: 3 };
    expect(effectivePlayedSec(1, o)).toBe(0);
    expect(effectivePlayedSec(2.5, o)).toBe(POLICY.MIN_PLAYED_SEC);
    expect(effectivePlayedSec(3, o)).toBe(POLICY.BUFFER_FALLBACK_SEC);
    expect(effectivePlayedSec(10, null)).toBe(10);
  });
});
