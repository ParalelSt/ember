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

describe('upsertCatalogTrack: the stream link is the server\'s, not the caller\'s', () => {
  // The catalog row is shared: the first member to like or add a song writes
  // it, and everyone after plays whatever stream_url it holds.
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

  it('takes the source and video from the id, so a mismatched sourceId cannot point the row elsewhere', async () => {
    const row = await created({ ...track, sourceId: 'zzzzzzzzzzz', streamUrl: '/api/youtube/stream/zzzzzzzzzzz' });
    expect(row).toMatchObject({ source: 'youtube', source_id: 'abcdefghijk', stream_url: '/api/youtube/stream/abcdefghijk' });
  });

  it('builds an upload\'s link from its record id', async () => {
    const row = await created({ ...track, id: 'upload:abc123def456ghi', source: 'upload', sourceId: 'abc123def456ghi', streamUrl: 'https://evil.example/x' });
    expect(row.stream_url).toBe('/api/uploads/abc123def456ghi/stream');
  });

  it('keeps a Jamendo link only when it is Jamendo\'s own https address', async () => {
    const ok = await created({ ...track, id: 'jamendo:123', source: 'jamendo', sourceId: '123', streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=123' });
    expect(ok.stream_url).toBe('https://prod-1.storage.jamendo.com/?trackid=123');
    const bad = await created({ ...track, id: 'jamendo:123', source: 'jamendo', sourceId: '123', streamUrl: 'https://evil.example/jamendo.com' });
    expect(bad.stream_url).toBe('');
  });
});
