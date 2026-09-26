import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearCastSignCache, castMediaFor, resolveCastMedia, signCastItems } from './signer';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { CastSignResponse } from './types';

vi.mock('@/lib/api', () => ({ apiUrl: (u: string) => u }));

const ORIGIN = 'https://ember.example.ts.net';
const YT = makeTrack({ id: 'youtube:aaaaaaaaaaa', title: 'Night', artist: 'Band', album: 'LP', artworkUrl: 'https://lh3.googleusercontent.com/x=w544' });
const UP = makeTrack({ id: 'upload:rec1', source: 'upload', sourceId: 'rec1', album: null, artworkUrl: '/api/uploads/rec1/art' });

describe('castMediaFor', () => {
  it('a YouTube song: the signed stream and its public cover as they are', () => {
    const m = castMediaFor(YT, { streamUrl: `${ORIGIN}/api/youtube/stream/aaaaaaaaaaa?st=t`, artworkUrl: null, contentType: 'audio/mp4' }, ORIGIN);
    expect(m).toEqual({
      url: `${ORIGIN}/api/youtube/stream/aaaaaaaaaaa?st=t`,
      contentType: 'audio/mp4',
      title: 'Night',
      artist: 'Band',
      album: 'LP',
      artworkUrl: 'https://lh3.googleusercontent.com/x=w544',
    });
  });

  it('an upload: the SIGNED cover, never the cookie-only one', () => {
    const signed = `${ORIGIN}/api/uploads/rec1/art?st=a`;
    expect(castMediaFor(UP, { streamUrl: 's', artworkUrl: signed, contentType: 'audio/flac' }, ORIGIN).artworkUrl).toBe(signed);
    expect(castMediaFor(UP, { streamUrl: 's', artworkUrl: null, contentType: 'audio/flac' }, ORIGIN).artworkUrl).toBeNull();
  });

  it('a relative cover goes on the public origin; protocol-relative gets https', () => {
    const rel = makeTrack({ artworkUrl: '/covers/x.jpg' });
    expect(castMediaFor(rel, { streamUrl: 's', artworkUrl: null, contentType: 'audio/mp4' }, `${ORIGIN}/`).artworkUrl).toBe(`${ORIGIN}/covers/x.jpg`);
    const proto = makeTrack({ artworkUrl: '//i.ytimg.com/vi/x/hq.jpg' });
    expect(castMediaFor(proto, { streamUrl: 's', artworkUrl: null, contentType: 'audio/mp4' }, ORIGIN).artworkUrl).toBe('https://i.ytimg.com/vi/x/hq.jpg');
    const blob = makeTrack({ artworkUrl: 'blob:http://x/1' });
    expect(castMediaFor(blob, { streamUrl: 's', artworkUrl: null, contentType: 'audio/mp4' }, ORIGIN).artworkUrl).toBeNull();
  });
});

describe('signCastItems', () => {
  const fetchMock = vi.fn();
  const answer = (ids: string[], expiresAt: number): CastSignResponse => ({
    origin: ORIGIN,
    expiresAt,
    items: Object.fromEntries(ids.map((id) => [id, { streamUrl: `${ORIGIN}/s/${id}`, artworkUrl: null, contentType: 'audio/mp4' }])),
  });
  beforeEach(() => {
    _clearCastSignCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the host once, with the cookie, and reuses fresh links', async () => {
    const now = 1_000_000;
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const { ids } = JSON.parse(String(init.body));
      return new Response(JSON.stringify(answer(ids, now + 6 * 3600)));
    });
    const first = await signCastItems(['youtube:aaaaaaaaaaa', 'youtube:bbbbbbbbbbb'], now);
    expect(first.size).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/cast/sign', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    await signCastItems(['youtube:aaaaaaaaaaa'], now + 3600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Within an hour of dying: signed again, so a song never starts on a link about to expire.
    await signCastItems(['youtube:aaaaaaaaaaa'], now + 5.5 * 3600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a refusal is an error (signed out)', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(signCastItems(['youtube:aaaaaaaaaaa'])).rejects.toThrow(/sign in/);
  });

  it('resolveCastMedia signs the song and the next few in one go', async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const { ids } = JSON.parse(String(init.body));
      return new Response(JSON.stringify(answer(ids, Date.now() / 1000 + 6 * 3600)));
    });
    const next = [1, 2, 3, 4, 5, 6].map((n) => makeTrack({ id: `youtube:nnnnnnnnnn${n}` }));
    const m = await resolveCastMedia(YT, next);
    expect(m.url).toBe(`${ORIGIN}/s/youtube:aaaaaaaaaaa`);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body)).ids;
    expect(sent).toEqual(['youtube:aaaaaaaaaaa', 'youtube:nnnnnnnnnn1', 'youtube:nnnnnnnnnn2', 'youtube:nnnnnnnnnn3', 'youtube:nnnnnnnnnn4']);
  });

  it('a track the host will not sign cannot be cast', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(answer([], 0))));
    await expect(resolveCastMedia(makeTrack({ id: 'jamendo:1' }))).rejects.toThrow(/cannot be cast/);
  });
});
