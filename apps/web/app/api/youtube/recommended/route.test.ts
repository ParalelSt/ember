// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

const t = (id: string, title = id): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title, artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '',
});

const h = vi.hoisted(() => ({ userId: null as string | null, blocked: [] as unknown[], recs: [] as unknown[] }));
vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => h.userId }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => ({}) }));
vi.mock('@/lib/blockedTracks', async (orig) => ({
  ...(await orig<typeof import('@/lib/blockedTracks')>()),
  listBlocked: async () => h.blocked,
}));
vi.mock('@/lib/sources/youtube', () => ({ getRecommended: async () => h.recs }));
vi.mock('@/lib/trackAvailability', () => ({ listUnavailableIds: async () => new Set<string>() }));
vi.mock('@/lib/sources/failureMemo', () => ({ unavailableTrackIds: () => new Set<string>() }));
vi.mock('@/lib/trending', () => ({ getTrendingChart: async () => ({ tracks: [] }), resolveTrendingCountry: () => 'US' }));
vi.mock('@/lib/rateLimit', () => ({ limitCaller: async () => null, PUBLIC_PYTHON_LIMITS: { recommended: {} } }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, handler: unknown) => handler }));

const { GET } = await import('./route');

const ask = async () => {
  const req = { nextUrl: new URL('http://x/api/youtube/recommended?seed=abcdefghijk') } as unknown as NextRequest;
  const res = await (GET as unknown as (r: NextRequest) => Promise<Response>)(req);
  return ((await res.json()) as { tracks: Track[] }).tracks.map((x) => x.sourceId);
};

beforeEach(() => {
  h.userId = null;
  h.blocked = [];
  h.recs = [t('good1'), t('bad', 'Bad Song'), t('bad2', 'Bad Song (Official Video)'), t('good2')];
});

describe('GET /api/youtube/recommended and blocked songs (owner request 2026-10-22)', () => {
  it('signed in, leaves out the blocked song and other uploads of it', async () => {
    h.userId = 'u1';
    h.blocked = [t('bad', 'Bad Song')];
    expect(await ask()).toEqual(['good1', 'good2']);
  });

  it('signed out, nothing is filtered', async () => {
    h.blocked = [t('bad', 'Bad Song')];
    expect(await ask()).toEqual(['good1', 'bad', 'bad2', 'good2']);
  });
});
