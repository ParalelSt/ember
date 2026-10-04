// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Track } from '@/types/track';

// upsertCatalogTrack writes with the server's catalog client (bughunt W03)
// and signs in again once when a reused token is refused.

const notFound = Object.assign(new Error('not found'), { status: 404 });
const refused = Object.assign(new Error('Only admins can perform this action.'), { status: 403 });

function client(createResult: () => Promise<unknown>) {
  const create = vi.fn(createResult);
  return {
    create,
    pb: { collection: () => ({ getFirstListItem: async () => Promise.reject(notFound), create, update: vi.fn() }) },
  };
}

const createCatalogClient = vi.fn();
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: (fresh?: boolean) => createCatalogClient(fresh) }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { upsertCatalogTrack } = await import('./upsertTrack');

const track: Track = {
  id: 'youtube:abcdefghijk',
  source: 'youtube',
  sourceId: 'abcdefghijk',
  title: 'Song',
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
};

beforeEach(() => createCatalogClient.mockReset());

describe('upsertCatalogTrack', () => {
  it('creates the row with the catalog client', async () => {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    expect(await upsertCatalogTrack(track)).toBe('rec1');
    expect(createCatalogClient).toHaveBeenCalledWith(undefined);
    expect(c.create).toHaveBeenCalledWith(expect.objectContaining({ external_id: 'youtube:abcdefghijk', title: 'Song' }));
  });

  it('signs in fresh once when the reused token is refused', async () => {
    const stale = client(async () => Promise.reject(refused));
    const fresh = client(async () => ({ id: 'rec2' }));
    createCatalogClient.mockResolvedValueOnce(stale.pb).mockResolvedValueOnce(fresh.pb);
    expect(await upsertCatalogTrack(track)).toBe('rec2');
    expect(createCatalogClient).toHaveBeenLastCalledWith(true);
  });

  it('passes other errors through', async () => {
    const broken = client(async () => Promise.reject(Object.assign(new Error('down'), { status: 502 })));
    createCatalogClient.mockResolvedValue(broken.pb);
    await expect(upsertCatalogTrack(track)).rejects.toThrow('down');
    expect(createCatalogClient).toHaveBeenCalledTimes(1);
  });
});

// The catalog is shared: a row one member creates is what every other
// member's player plays. Its source and stream URL therefore come from the
// track id, never from what the client sent.
describe('upsertCatalogTrack: what a member may not choose', () => {
  it('derives a YouTube stream URL instead of storing the client one', async () => {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    await upsertCatalogTrack({ ...track, streamUrl: '//evil.example/a.m4a', source: 'jamendo' as const, sourceId: 'zzz' });
    expect(c.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'youtube',
      source_id: 'abcdefghijk',
      stream_url: '/api/youtube/stream/abcdefghijk',
    }));
  });

  it('derives an upload stream URL', async () => {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    await upsertCatalogTrack({ ...track, id: 'upload:abc123', source: 'upload', sourceId: 'abc123', streamUrl: 'https://evil.example/x' });
    expect(c.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'upload',
      source_id: 'abc123',
      stream_url: '/api/uploads/abc123/stream',
    }));
  });

  it('keeps a Jamendo stream URL only when it points at Jamendo', async () => {
    const ok = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(ok.pb);
    const jam = { ...track, id: 'jamendo:123', source: 'jamendo' as const, sourceId: '123' };
    await upsertCatalogTrack({ ...jam, streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31' });
    expect(ok.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'jamendo',
      stream_url: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31',
    }));
    const bad = client(async () => ({ id: 'rec2' }));
    createCatalogClient.mockResolvedValue(bad.pb);
    await upsertCatalogTrack({ ...jam, streamUrl: 'https://jamendo.com.evil.example/x' });
    expect(bad.create).toHaveBeenCalledWith(expect.objectContaining({ stream_url: '' }));
  });

  it('refuses an id that is no known source with a 400', async () => {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    await expect(upsertCatalogTrack({ ...track, id: 'evil:"x' })).rejects.toMatchObject({ status: 400 });
    expect(c.create).not.toHaveBeenCalled();
  });
});
