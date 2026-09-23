// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bughunt S04: the limiter keyed anonymous callers on a hash of whatever
// pb_auth cookie they sent, or on the first X-Forwarded-For entry. Both are
// typed by the caller, so a new cookie or a new header gave a fresh bucket
// on every request. And buckets were never deleted.

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => auth.userId }));

const { callerKey, checkRateLimit, clientIp, _bucketCount, _resetBuckets } = await import('./rateLimit');

function req(headers: Record<string, string>): Request {
  return new Request('http://ember.test/api/youtube/search?q=x', { headers });
}

beforeEach(() => {
  auth.userId = null;
  _resetBuckets();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('clientIp', () => {
  it('uses the address the nearest proxy appended, not what the caller typed', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('a single entry (what Tailscale Funnel and Next set) is the client', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores x-real-ip, which nothing in front of Ember sets', () => {
    expect(clientIp(req({ 'x-real-ip': '7.7.7.7' }))).toBe('unknown');
  });
});

describe('callerKey', () => {
  it('a verified session is keyed on the user id', async () => {
    auth.userId = 'u123';
    expect(await callerKey(req({ cookie: 'pb_auth=whatever', 'x-forwarded-for': '203.0.113.9' }))).toBe('user:u123');
  });

  it('a forged cookie does not buy a fresh bucket: it falls back to the IP', async () => {
    const a = await callerKey(req({ cookie: 'pb_auth=forged-1', 'x-forwarded-for': '203.0.113.9' }));
    const b = await callerKey(req({ cookie: 'pb_auth=forged-2', 'x-forwarded-for': '203.0.113.9' }));
    expect(a).toBe('ip:203.0.113.9');
    expect(b).toBe(a);
  });

  it('rotating a spoofed X-Forwarded-For prefix keeps the same key', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) {
      keys.add(await callerKey(req({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9` })));
    }
    expect([...keys]).toEqual(['ip:203.0.113.9']);
  });
});

describe('bucket eviction', () => {
  it('expired buckets are dropped instead of piling up', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 500; i++) checkRateLimit(`k${i}`, { windowMs: 1_000, max: 5 });
    expect(_bucketCount()).toBe(500);
    vi.advanceTimersByTime(61_000);
    checkRateLimit('fresh', { windowMs: 1_000, max: 5 });
    expect(_bucketCount()).toBe(1);
  });

  it('a bucket still inside its window survives the sweep', () => {
    vi.useFakeTimers();
    checkRateLimit('short', { windowMs: 1_000, max: 5 });
    checkRateLimit('long', { windowMs: 3_600_000, max: 5 });
    vi.advanceTimersByTime(61_000);
    checkRateLimit('other', { windowMs: 1_000, max: 5 });
    expect(_bucketCount()).toBe(2);
    // And it still remembers its hits.
    for (let i = 0; i < 4; i++) checkRateLimit('long', { windowMs: 3_600_000, max: 5 });
    expect(checkRateLimit('long', { windowMs: 3_600_000, max: 5 }).ok).toBe(false);
  });

  it('still limits: max hits per window, then a retry-after', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('x', { windowMs: 60_000, max: 3 }).ok).toBe(true);
    const r = checkRateLimit('x', { windowMs: 60_000, max: 3 });
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});
