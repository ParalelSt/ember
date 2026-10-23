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

describe('file uploads answer like every other call', () => {
  const file = new File([new Uint8Array([1])], 'a.mp3', { type: 'audio/mpeg' });

  it('a 401 drops the dead session and carries its status', async () => {
    const { onSessionExpired } = await import('./sessionExpired');
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    vi.stubGlobal('fetch', answer(401, { error: 'Unauthorized' }));
    await expect(api.uploadTrack(file, { title: 't', artist: 'a', durationSec: 1 })).rejects.toMatchObject({ status: 401 });
    await expect(api.updateProfile({ name: 'x' })).rejects.toMatchObject({ status: 401 });
    await expect(api.updatePlaylistArtwork('p1', file)).rejects.toMatchObject({ status: 401 });
    await expect(api.uploadTabFile(file, { title: 't', artist: 'a' })).rejects.toMatchObject({ status: 401 });
    off();
    expect(expired).toHaveBeenCalledTimes(4);
  });

  it('too large and not audio are answers, with the server sentence', async () => {
    vi.stubGlobal('fetch', answer(415, { error: 'Unsupported audio type: audio/x-foo' }));
    await expect(api.uploadTrack(file, { title: 't', artist: 'a', durationSec: 1 })).rejects.toMatchObject({
      status: 415,
      message: 'Unsupported audio type: audio/x-foo',
    });
    vi.stubGlobal('fetch', answer(413, { error: 'File too large, the limit is 5MB' }));
    await expect(api.uploadTabFile(file, { title: 't', artist: 'a' })).rejects.toMatchObject({ status: 413 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a tab upload with no sentence from the server still says one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(api.uploadTabFile(file, { title: 't', artist: 'a' })).rejects.toThrow('That file could not be added.');
  });

  it('sends the form as multipart, with no JSON content type', async () => {
    const fetch = answer(201, { track: { id: 'upload:x' } });
    vi.stubGlobal('fetch', fetch);
    await api.uploadTrack(file, { title: 't', artist: 'a', durationSec: 1.6 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/uploads');
    expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get('durationSec')).toBe('2');
  });
});

describe('Transfer: the refusals the import routes word for people are answers', () => {
  const cases: [string, () => Promise<unknown>, number][] = [
    ['a private YouTube playlist', () => api.importInspect('https://music.youtube.com/playlist?list=PLx'), 403],
    ['a Spotify link that is not a playlist', () => api.importInspect('https://open.spotify.com/album/x'), 400],
    ['a playlist that is gone', () => api.importStart('https://open.spotify.com/playlist/x', 'liked'), 404],
    ['every song already liked', () => api.importStart('https://open.spotify.com/playlist/x', 'liked', { skipLiked: true }), 422],
    ['a file over 20 MB', () => api.transferPreview({ text: 'x' }), 413],
    ['no songs in it', () => api.transferStart({ text: 'x' }), 422],
    ['a Google sign-in that is over, at Start', () => api.googleLikesStart('f'.repeat(24)), 404],
  ];
  for (const [name, call, status] of cases) {
    it(name, async () => {
      vi.stubGlobal('fetch', answer(status, { error: 'A sentence.' }));
      await expect(call()).rejects.toMatchObject({ status, message: 'A sentence.' });
      expect(logger.error).not.toHaveBeenCalled();
    });
  }

  it('a failure of the route itself is still a fault', async () => {
    vi.stubGlobal('fetch', answer(500, { error: 'Internal error' }));
    await expect(api.importInspect('https://open.spotify.com/playlist/x')).rejects.toMatchObject({ status: 500 });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('Carlist: a carlist that ended between two polls is an answer', () => {
  const song = { id: 'youtube:x', source: 'youtube', sourceId: 'x', title: 'Song', artist: 'A' } as Parameters<typeof api.addToSession>[1];
  it('add, skip, the host command poll and the playing row all take a 410 as one', async () => {
    vi.stubGlobal('fetch', answer(410, { error: 'This session has ended.' }));
    await expect(api.addToSession('s1', song)).rejects.toMatchObject({ status: 410, message: 'This session has ended.' });
    await expect(api.skipSession('s1', 2)).rejects.toMatchObject({ status: 410 });
    await expect(api.consumeSessionCommands('s1')).rejects.toMatchObject({ status: 410 });
    await expect(api.publishSessionNow('s1', 3)).rejects.toMatchObject({ status: 410 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(4);
  });
});

describe('bulk copies go in batches the routes take', () => {
  it('liking 501 songs at once sends two confirmed requests of at most 500, and adds the answers', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { tracks } = JSON.parse(String(init.body)) as { tracks: unknown[] };
      return Response.json({ added: tracks.length - 1, skipped: [{ id: 'dup', title: 't', artist: 'a', reason: 'same-track', existingTitle: 't' }] }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetch);
    const songs = Array.from({ length: 501 }, (_, i) => ({ id: `youtube:s${i}` }) as Parameters<typeof api.bulkLike>[0][number]);
    const outcome = await api.bulkLike(songs);
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String(c[1].body)) as { tracks: unknown[]; confirmed: boolean });
    expect(bodies.map((b) => b.tracks.length)).toEqual([500, 1]);
    expect(bodies.every((b) => b.confirmed === true)).toBe(true);
    expect(outcome).toMatchObject({ added: 499, skipped: [{ id: 'dup' }, { id: 'dup' }] });
  });
});

describe('a playlist that is gone (404) is an answer on adds and removes', () => {
  const song = { id: 'youtube:x', source: 'youtube', sourceId: 'x', title: 'Song', artist: 'A' } as Parameters<typeof api.addToPlaylist>[1];
  it('add, bulk add and remove log the 404 as a warning', async () => {
    vi.stubGlobal('fetch', answer(404, { error: "That playlist doesn't exist, or isn't yours" }));
    await expect(api.addToPlaylist('p1', song)).rejects.toMatchObject({ status: 404 });
    await expect(api.bulkAddToPlaylist('p1', [song])).rejects.toMatchObject({ status: 404 });
    await expect(api.removeFromPlaylist('p1', song.id)).rejects.toMatchObject({ status: 404 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(3);
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
