// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// Radio asks this route for what comes after the last song. A 502 from it
// (the Python helper process failing) left radio with nothing, so the music
// stopped at the end of the queue, and every one sent an automatic bug
// report. The helper's own fallback is today's chart; the route now does the
// same when the helper itself fails.

const track = (id: string): Track => ({
  id: `youtube:${id}`, sourceId: id, source: 'youtube', title: id, artist: 'X', durationSec: 200, artworkUrl: '',
} as Track);

vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => null }));
vi.mock('@/lib/sources/youtube', () => ({ getRecommended: vi.fn() }));
vi.mock('@/lib/trackAvailability', () => ({ listUnavailableIds: vi.fn(async () => new Set(['youtube:deadChart01'])) }));
vi.mock('@/lib/sources/failureMemo', () => ({ unavailableTrackIds: () => new Set<string>() }));
vi.mock('@/lib/trending', () => ({
  resolveTrendingCountry: () => 'ZZ',
  getTrendingChart: vi.fn(async () => ({ tracks: [track('chartSong01'), track('deadChart01'), track('chartSong02')] })),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: { message?: string; status?: number }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { GET } = await import('./route');
const { getRecommended } = await import('@/lib/sources/youtube');
const { getTrendingChart } = await import('@/lib/trending');
const { serverLogger } = await import('@/lib/logger/server');
const { _resetBuckets } = await import('@/lib/rateLimit');

const SEED = 'NxvzO45X8I8';
const ask = (seed?: string) =>
  GET(new NextRequest(`http://ember.test/api/youtube/recommended${seed ? `?seed=${seed}` : ''}`, {
    headers: { 'x-forwarded-for': '198.51.100.7' },
  }), undefined);

const helperFailure = (status: number, message = 'the media helper failed (exit 1)') =>
  Object.assign(new Error(message), { status });

beforeEach(() => {
  vi.clearAllMocks();
  _resetBuckets();
});

describe('GET /api/youtube/recommended', () => {
  it('answers the seed\'s recommendations, without songs known to be dead', async () => {
    vi.mocked(getRecommended).mockResolvedValue([track('recSong0001'), track('deadChart01')]);
    const res = await ask(SEED);
    expect(res.status).toBe(200);
    expect((await res.json()).tracks.map((t: Track) => t.id)).toEqual(['youtube:recSong0001']);
    expect(getTrendingChart).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504])('a helper that fails (%i) answers today\'s chart instead, as a warning', async (status) => {
    vi.mocked(getRecommended).mockRejectedValue(helperFailure(status));
    const res = await ask(SEED);
    expect(res.status).toBe(200);
    expect((await res.json()).tracks.map((t: Track) => t.id)).toEqual(['youtube:chartSong01', 'youtube:chartSong02']);
    expect(serverLogger.warn).toHaveBeenCalledWith('python', 'recommended helper failed, serving the chart instead', expect.objectContaining({ seed: SEED, status }));
    expect(serverLogger.error).not.toHaveBeenCalled();
  });

  it('any other failure still answers its own status', async () => {
    vi.mocked(getRecommended).mockRejectedValue(helperFailure(500, 'boom'));
    const res = await ask(SEED);
    expect(res.status).toBe(500);
    expect(getTrendingChart).not.toHaveBeenCalled();
  });

  it('no seed: the chart, with no helper run', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(getRecommended).not.toHaveBeenCalled();
    expect((await res.json()).tracks).toHaveLength(2);
  });
});
