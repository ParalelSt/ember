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
