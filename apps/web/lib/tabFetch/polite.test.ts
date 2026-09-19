// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BROWSER_UA, FetchStatusError, PoliteFetcher, SiteBackoffError } from './polite';

/** A clock the fetcher's sleeps move forward, and a fetch that records when
 *  each request was sent and answers from a list. */
function harness(statuses: number[] = [], opts: { gapMs?: number; backoffMs?: number } = {}) {
  let now = 1_000_000;
  const sentAt: number[] = [];
  const headers: Record<string, string>[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    sentAt.push(now);
    headers.push(init?.headers as Record<string, string>);
    const status = statuses.shift() ?? 200;
    return new Response(`body ${sentAt.length}`, { status });
  }) as unknown as typeof fetch;
  const fetcher = new PoliteFetcher({
    gapMs: opts.gapMs ?? 2000,
    backoffMs: opts.backoffMs ?? 3_600_000,
    fetch: fetchFn,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { fetcher, sentAt, headers, advance: (ms: number) => (now += ms), now: () => now };
}

describe('the polite fetcher', () => {
  it('sends a browser User-Agent', async () => {
    const h = harness();
    await h.fetcher.getText('ug', 'https://x/1');
    expect(h.headers[0]['User-Agent']).toBe(BROWSER_UA);
    expect(h.headers[0]['User-Agent']).toMatch(/Mozilla\/5\.0/);
  });

  it('keeps 2 s between requests to one site, even when asked at once', async () => {
    const h = harness();
    const bodies = await Promise.all([1, 2, 3].map((i) => h.fetcher.getText('ug', `https://x/${i}`)));
    expect(bodies).toEqual(['body 1', 'body 2', 'body 3']);
    expect(h.sentAt[1] - h.sentAt[0]).toBeGreaterThanOrEqual(2000);
    expect(h.sentAt[2] - h.sentAt[1]).toBeGreaterThanOrEqual(2000);
  });

  it('does not wait when the last request was long ago', async () => {
    const h = harness();
    await h.fetcher.getText('ug', 'https://x/1');
    h.advance(10_000);
    const before = h.now();
    await h.fetcher.getText('ug', 'https://x/2');
    expect(h.sentAt[1]).toBe(before);
  });

  it('keeps separate queues per site', async () => {
    const h = harness();
    await Promise.all([h.fetcher.getText('ug', 'https://x/1'), h.fetcher.getText('songsterr', 'https://y/1')]);
    expect(h.sentAt[0]).toBe(h.sentAt[1]);
  });

  for (const status of [429, 403, 503]) {
    it(`backs off for an hour on ${status}: nothing is sent meanwhile`, async () => {
      const h = harness([status]);
      await expect(h.fetcher.getText('ug', 'https://x/1')).rejects.toBeInstanceOf(SiteBackoffError);
      h.advance(30 * 60 * 1000);
      await expect(h.fetcher.getText('ug', 'https://x/2')).rejects.toBeInstanceOf(SiteBackoffError);
      expect(h.sentAt).toHaveLength(1);
      expect(h.fetcher.backoffUntil('ug')).not.toBeNull();
      h.advance(31 * 60 * 1000);
      expect(h.fetcher.backoffUntil('ug')).toBeNull();
      await expect(h.fetcher.getText('ug', 'https://x/3')).resolves.toBe('body 2');
      expect(h.sentAt).toHaveLength(2);
    });
  }

  it('does not back off on a plain 404, and the queue carries on after a failure', async () => {
    const h = harness([404, 200]);
    await expect(h.fetcher.getText('ug', 'https://x/1')).rejects.toBeInstanceOf(FetchStatusError);
    expect(h.fetcher.backoffUntil('ug')).toBeNull();
    await expect(h.fetcher.getText('ug', 'https://x/2')).resolves.toBe('body 2');
  });

  it('a backoff on one site leaves the other alone', async () => {
    const h = harness([429, 200]);
    await expect(h.fetcher.getText('ug', 'https://x/1')).rejects.toBeInstanceOf(SiteBackoffError);
    await expect(h.fetcher.getText('songsterr', 'https://y/1')).resolves.toBe('body 2');
  });

  it('a caller can back off on its own (a block page served as a 200)', async () => {
    const h = harness();
    h.fetcher.backOff('ug', null);
    await expect(h.fetcher.getText('ug', 'https://x/1')).rejects.toBeInstanceOf(SiteBackoffError);
    expect(h.sentAt).toHaveLength(0);
  });

  it('counts what it sent', async () => {
    const h = harness();
    await h.fetcher.getText('ug', 'https://x/1');
    await h.fetcher.getText('ug', 'https://x/2');
    expect(h.fetcher.sent.get('ug')).toBe(2);
  });
});
