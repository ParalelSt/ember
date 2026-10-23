import { describe, it, expect, vi } from 'vitest';
import { api } from './api';

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => Response.json(body, { status, headers }));

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
