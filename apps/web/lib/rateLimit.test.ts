// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkRateLimit, rateLimitResponse, recordRateLimitHit } from './rateLimit';

const cfg = { windowMs: 60_000, max: 2 };

describe('rateLimit consume:false / recordRateLimitHit', () => {
  it('consume:false does not use up the quota, even repeatedly', () => {
    const key = `peek-${Math.random()}`;
    expect(checkRateLimit(key, cfg, { consume: false }).ok).toBe(true);
    expect(checkRateLimit(key, cfg, { consume: false }).ok).toBe(true);
    expect(checkRateLimit(key, cfg, { consume: false }).ok).toBe(true);
    // Real quota (max 2) is still fully available.
    expect(checkRateLimit(key, cfg).ok).toBe(true);
    expect(checkRateLimit(key, cfg).ok).toBe(true);
    expect(checkRateLimit(key, cfg).ok).toBe(false);
  });

  it('recordRateLimitHit charges the quota so a later check sees it', () => {
    const key = `record-${Math.random()}`;
    recordRateLimitHit(key, cfg);
    recordRateLimitHit(key, cfg);
    expect(checkRateLimit(key, cfg, { consume: false }).ok).toBe(false);
  });

  it('rateLimitResponse with consume:false still rejects an already-over-limit caller', () => {
    const key = `resp-${Math.random()}`;
    recordRateLimitHit(key, cfg);
    recordRateLimitHit(key, cfg);
    const res = rateLimitResponse(key, cfg, { consume: false });
    expect(res?.status).toBe(429);
    // Checking again did not add a third hit; the bucket is still exactly 2.
    expect(checkRateLimit(key, cfg, { consume: false }).ok).toBe(false);
  });
});
