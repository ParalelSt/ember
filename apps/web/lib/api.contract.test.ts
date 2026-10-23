import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api';
import { logger } from '@/lib/logger/client';

// What req() makes of the answers the routes give: which ones are a fault
// (logger.error, which sends an automatic bug report) and which are an
// answer the app shows (a warning).

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => Response.json(body, { status, headers }));

beforeEach(() => {
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe('req(): a rate limit is an answer, not a fault', () => {
  it('logs a 429 as a warning and still throws its sentence and status', async () => {
    vi.stubGlobal('fetch', answer(429, { error: 'Slow down, try again in about 12s.' }, { 'Retry-After': '12' }));
    await expect(api.search('abc')).rejects.toMatchObject({ status: 429, message: 'Slow down, try again in about 12s.' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('pages that say "not found" log that answer as a warning', () => {
  const cases: [string, () => Promise<unknown>, number][] = [
    ['artist 404', () => api.getArtist('UCnope'), 404],
    ['artist id that is not one', () => api.getArtist('x'), 400],
    ['album 404', () => api.getAlbum('MPREb_nope123'), 404],
    ['shared track 404', () => api.getTrack('aaaaaaaaaaa'), 404],
    ['carlist gone', () => api.getSession('s1'), 404],
    ['carlist not joined', () => api.getSession('s1'), 403],
  ];
  for (const [name, call, status] of cases) {
    it(name, async () => {
      vi.stubGlobal('fetch', answer(status, { error: 'not found' }));
      await expect(call()).rejects.toMatchObject({ status });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  }

  it('anything else on those pages is still a fault', async () => {
    vi.stubGlobal('fetch', answer(500, { error: 'boom' }));
    await expect(api.getSession('s1')).rejects.toMatchObject({ status: 500 });
    await expect(api.getArtist('UCx')).rejects.toMatchObject({ status: 500 });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('ids in the path are encoded', () => {
  // A playlist or carlist id comes from the page's own URL, so a link can
  // carry anything: "../x" must not step out to another route.
  it('a playlist, carlist or tab id cannot reach another route', async () => {
    const fetch = answer(200, { ok: true });
    vi.stubGlobal('fetch', fetch);
    await api.deletePlaylist('../likes/x');
    await api.endSession('../../admin/backups?');
    await api.deleteTabFile('a/b');
    await api.renamePlaylist('p?x=1', 'n');
    const urls = fetch.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual([
      '/api/playlists/..%2Flikes%2Fx',
      '/api/sessions/..%2F..%2Fadmin%2Fbackups%3F/end',
      '/api/tabs/files/a%2Fb',
      '/api/playlists/p%3Fx%3D1',
    ]);
  });
});
