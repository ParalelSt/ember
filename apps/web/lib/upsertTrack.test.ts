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
// member's player plays (the first member to like, add or search-play a song
// writes it). Its source and stream URL therefore come from the track id,
// never from what the client sent.
describe('upsertCatalogTrack: what a member may not choose', () => {
  async function created(t: Track) {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    await upsertCatalogTrack(t);
    return (c.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
  }

  it('builds a YouTube song\'s link from its id, ignoring one sent along', async () => {
    const row = await created({ ...track, streamUrl: 'https://evil.example/a.m4a' });
    expect(row.stream_url).toBe('/api/youtube/stream/abcdefghijk');
  });

  it('ignores a protocol-relative link and a mismatched source sent along', async () => {
    const row = await created({ ...track, streamUrl: '//evil.example/a.m4a', source: 'jamendo', sourceId: 'zzz' });
    expect(row).toMatchObject({ source: 'youtube', source_id: 'abcdefghijk', stream_url: '/api/youtube/stream/abcdefghijk' });
  });

  it('takes the source and video from the id, so a mismatched sourceId cannot point the row elsewhere', async () => {
    const row = await created({ ...track, sourceId: 'zzzzzzzzzzz', streamUrl: '/api/youtube/stream/zzzzzzzzzzz' });
    expect(row).toMatchObject({ source: 'youtube', source_id: 'abcdefghijk', stream_url: '/api/youtube/stream/abcdefghijk' });
  });

  it('builds an upload\'s link from its record id', async () => {
    const row = await created({ ...track, id: 'upload:abc123def456ghi', source: 'upload', sourceId: 'abc123def456ghi', streamUrl: 'https://evil.example/x' });
    expect(row).toMatchObject({ source: 'upload', source_id: 'abc123def456ghi', stream_url: '/api/uploads/abc123def456ghi/stream' });
    const short = await created({ ...track, id: 'upload:abc123', source: 'upload', sourceId: 'abc123', streamUrl: 'https://evil.example/x' });
    expect(short).toMatchObject({ source: 'upload', source_id: 'abc123', stream_url: '/api/uploads/abc123/stream' });
  });

  it('keeps a Jamendo link only when it is Jamendo\'s own https address', async () => {
    const jam = { ...track, id: 'jamendo:123', source: 'jamendo' as const, sourceId: '123' };
    const ok = await created({ ...jam, streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31' });
    expect(ok).toMatchObject({ source: 'jamendo', source_id: '123', stream_url: 'https://prod-1.storage.jamendo.com/?trackid=123&format=mp31' });
    for (const streamUrl of ['https://evil.example/jamendo.com', 'https://jamendo.com.evil.example/x', '//prod-1.storage.jamendo.com/x']) {
      const bad = await created({ ...jam, streamUrl });
      expect(bad.stream_url).toBe('');
    }
  });

  it('refuses an id that is no known source with a 400', async () => {
    const c = client(async () => ({ id: 'rec1' }));
    createCatalogClient.mockResolvedValue(c.pb);
    await expect(upsertCatalogTrack({ ...track, id: 'evil:"x' })).rejects.toMatchObject({ status: 400 });
    expect(c.create).not.toHaveBeenCalled();
  });
});
