// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The route's three independent reads (gone-song list, suggestions, who is
// asking plus their blocked list) must start together, not one after the
// other: Home's rows wait on this route.

const t = (id: string): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title: id, artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '',
});

const h = vi.hoisted(() => ({ started: [] as string[], release: {} as Record<string, () => void> }));
const gate = (name: string) => {
  h.started.push(name);
  return new Promise<void>((r) => { h.release[name] = r; });
};
vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => { await gate('user'); return 'u1'; } }));
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: async () => ({}) }));
vi.mock('@/lib/blockedTracks', async (orig) => ({
  ...(await orig<typeof import('@/lib/blockedTracks')>()),
  listBlocked: async () => [t('bad')],
}));
vi.mock('@/lib/sources/youtube', () => ({
  getRecommended: async () => { await gate('recs'); return [t('good'), t('bad'), t('gone')]; },
}));
vi.mock('@/lib/trackAvailability', () => ({
  listUnavailableIds: async () => { await gate('dead'); return new Set(['youtube:gone']); },
}));
vi.mock('@/lib/sources/failureMemo', () => ({ unavailableTrackIds: () => new Set<string>() }));
vi.mock('@/lib/trending', () => ({ getTrendingChart: async () => ({ tracks: [] }), resolveTrendingCountry: () => 'US' }));
vi.mock('@/lib/rateLimit', () => ({ limitCaller: async () => null, PUBLIC_PYTHON_LIMITS: { recommended: {} } }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, handler: unknown) => handler }));

const { GET } = await import('./route');

beforeEach(() => {
  h.started.length = 0;
});

describe('GET /api/youtube/recommended', () => {
  it('starts all three reads before any of them finishes, and the answer is the same', async () => {
    const req = { nextUrl: new URL('http://x/api/youtube/recommended?seed=abcdefghijk') } as unknown as NextRequest;
    const pending = (GET as unknown as (r: NextRequest) => Promise<Response>)(req);
    await vi.waitFor(() => expect([...h.started].sort()).toEqual(['dead', 'recs', 'user']));
    for (const name of ['user', 'recs', 'dead']) h.release[name]();
    const body = (await (await pending).json()) as { tracks: Track[] };
    expect(body.tracks.map((x) => x.sourceId)).toEqual(['good']);
  });
});
