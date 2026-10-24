// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const update = vi.fn();
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => ({
      pb: { collection: () => ({ update: (...a: unknown[]) => update(...a) }) },
      user: { id: 'u1' },
    }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
vi.mock('@/lib/playlistAccess', () => ({
  playlistAccess: async () => ({ role: 'owner' }),
  notFound: () => Response.json({ error: 'Playlist not found' }, { status: 404 }),
  ownerOnly: () => Response.json({ error: 'Owner only' }, { status: 403 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { PATCH } = await import('./route');
const { api } = await import('@/lib/api');
const { logger } = await import('@/lib/logger/client');

describe('PATCH /api/playlists/[id]/artwork', () => {
  it('answers a body that is not multipart with a 400, not a 500', async () => {
    const req = new NextRequest('http://ember.test/api/playlists/p1/artwork', {
      method: 'PATCH',
      body: JSON.stringify({ artwork: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('a cover too large or not an image it takes is a 413/415 with a sentence, shown as an answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const req = new NextRequest(`http://ember.test${url}`, { method: 'PATCH', body: init.body as FormData });
      return PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    }));
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'cover.jpg', { type: 'image/jpeg' });
    await expect(api.updatePlaylistArtwork('p1', big)).rejects.toMatchObject({ status: 413, message: 'That image is too large: the limit is 5 MB' });
    const heic = new File([new Uint8Array([1])], 'cover.heic', { type: 'image/heic' });
    await expect(api.updatePlaylistArtwork('p1', heic)).rejects.toMatchObject({ status: 415 });
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a picture whose browser gave no type is taken when its bytes are an image it takes, as PocketBase did', async () => {
    update.mockReset();
    update.mockResolvedValue({ id: 'p1', name: 'Mix', created: '', artwork: 'cover_x.png' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const req = new NextRequest(`http://ember.test${url}`, { method: 'PATCH', body: init.body as FormData });
      return PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await expect(api.updatePlaylistArtwork('p1', new File([png], 'cover', { type: '' }))).resolves.toMatchObject({
      playlist: { id: 'p1' },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const sent = (update.mock.calls[0][1] as FormData).get('artwork') as File;
    expect(sent.type).toBe('image/png');
    // A WebP, a GIF and a JPEG with no type are taken too.
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const gif = new TextEncoder().encode('GIF89a......');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    for (const bytes of [webp, gif, jpeg]) {
      await expect(api.updatePlaylistArtwork('p1', new File([bytes], 'cover', { type: 'application/octet-stream' }))).resolves.toBeTruthy();
    }
    expect(update).toHaveBeenCalledTimes(4);
    // No type and not an image: still refused, and the size limit still holds.
    const text = new File([new TextEncoder().encode('hello there')], 'cover', { type: '' });
    await expect(api.updatePlaylistArtwork('p1', text)).rejects.toMatchObject({ status: 415 });
    const bigPng = new File([png, new Uint8Array(5 * 1024 * 1024)], 'cover', { type: '' });
    await expect(api.updatePlaylistArtwork('p1', bigPng)).rejects.toMatchObject({ status: 413 });
    expect(update).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });
});
