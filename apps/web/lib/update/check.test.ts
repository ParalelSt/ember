import { describe, expect, it, vi } from 'vitest';
import { findUpdates, newer, pickOffer, shellCanRestart } from './check';

/** What counts as a newer Ember. The bug: the desktop app kept running the
 *  web build it loaded (0.7.42) after the host moved to 0.7.43, and nothing
 *  ever compared the two. */

describe('newer', () => {
  it('compares plain versions, build stamps included', () => {
    expect(newer('0.7.43', '0.7.42')).toBe(true);
    expect(newer('0.7.43 (d6e9e338 2026-11-13)', '0.7.42')).toBe(true);
    expect(newer('0.7.42', '0.7.42')).toBe(false);
    expect(newer('0.7.41', '0.7.42')).toBe(false);
  });

  it('never calls a missing or malformed version an update', () => {
    expect(newer(null, '0.7.42')).toBe(false);
    expect(newer('0.7.43', null)).toBe(false);
    expect(newer('garbage', '0.7.42')).toBe(false);
  });
});

describe('shellCanRestart', () => {
  it('is true from the desktop app that has update_restart', () => {
    expect(shellCanRestart('0.4.26')).toBe(false);
    expect(shellCanRestart('0.4.27')).toBe(true);
    expect(shellCanRestart('0.5.0')).toBe(true);
    expect(shellCanRestart(null)).toBe(false);
  });
});

describe('pickOffer', () => {
  it('offers the web build the host runs when it is newer', () => {
    expect(pickOffer({ webLatest: '0.7.43', shellLatest: '0.4.26' }, { web: '0.7.42', shell: '0.4.26' })).toEqual({
      kind: 'web',
      version: '0.7.43',
      canApply: true,
    });
  });

  it('offers nothing when everything is current', () => {
    expect(pickOffer({ webLatest: '0.7.43', shellLatest: '0.4.26' }, { web: '0.7.43', shell: '0.4.26' })).toBeNull();
    expect(pickOffer({ webLatest: null, shellLatest: null }, { web: '0.7.43', shell: '0.4.26' })).toBeNull();
  });

  it('puts a desktop app that can restart itself first: the restart brings the web build too', () => {
    expect(pickOffer({ webLatest: '0.7.44', shellLatest: '0.4.28' }, { web: '0.7.43', shell: '0.4.27' })).toEqual({
      kind: 'shell',
      version: '0.4.28',
      canApply: true,
    });
  });

  it('on an older desktop app, offers the web reload first, then a quit-and-reopen', () => {
    expect(pickOffer({ webLatest: '0.7.44', shellLatest: '0.4.27' }, { web: '0.7.43', shell: '0.4.26' })?.kind).toBe('web');
    expect(pickOffer({ webLatest: '0.7.43', shellLatest: '0.4.27' }, { web: '0.7.43', shell: '0.4.26' })).toEqual({
      kind: 'shell',
      version: '0.4.27',
      canApply: false,
    });
  });

  it('never offers a desktop app in a browser', () => {
    expect(pickOffer({ webLatest: '0.7.43', shellLatest: '0.4.27' }, { web: '0.7.43', shell: null })).toBeNull();
  });
});

function fakeFetch(answers: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    const body = key ? answers[key] : undefined;
    if (body === undefined) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('findUpdates', () => {
  it('asks the host for its web version and, on desktop, the newest app for this platform', async () => {
    const f = fakeFetch({
      '/api/version': { version: '0.7.43 (d6e9e338 2026-11-13)' },
      '/api/app/update': { latest: '0.4.27' },
    });
    const r = await findUpdates({ platform: 'windows', shell: '0.4.26' }, f);
    expect(r).toEqual({ webLatest: '0.7.43', shellLatest: '0.4.27', failed: false });
    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/app/update?platform=windows&version=0.4.26');
    // Never a cached answer: the whole point is noticing a change.
    expect(f.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('asks only for the web version in a browser', async () => {
    const f = fakeFetch({ '/api/version': { version: '0.7.43 (x 2026-11-13)' } });
    const r = await findUpdates({ platform: 'browser', shell: null }, f);
    expect(r).toEqual({ webLatest: '0.7.43', shellLatest: null, failed: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('says it failed, and finds nothing, when the host does not answer', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await findUpdates({ platform: 'windows', shell: '0.4.26' }, f)).toEqual({
      webLatest: null,
      shellLatest: null,
      failed: true,
    });
  });
});
