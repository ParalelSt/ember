// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

let fake: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => fake.pb }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const {
  _resetAvailabilityCache, freshUnavailableMark, listUnavailableIds, markTrackUnavailable, UNAVAILABLE_RECHECK_MS,
} = await import('./trackAvailability');

const DAY = 24 * 60 * 60 * 1000;
/** PocketBase's date format ("2026-09-30 10:00:00.000Z"). */
const pbDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ');

beforeEach(() => _resetAvailabilityCache());

describe('the unavailable flag in the tracks table', () => {
  it('a fresh flag is trusted, with its reason, so the stream route can skip yt-dlp', async () => {
    const now = Date.now();
    fake = fakePocketBase({ tracks: [{ id: 'r1', external_id: 'youtube:gone0000001', unavailable_at: pbDate(now - DAY), unavailable_reason: 'removed' }] });
    expect(await freshUnavailableMark('youtube:gone0000001', now)).toMatchObject({ reason: 'removed' });
    expect(await freshUnavailableMark('youtube:other000001', now)).toBeNull();
    expect(await listUnavailableIds()).toEqual(new Set(['youtube:gone0000001']));
  });

  it('an old flag is not: one play may ask YouTube again (a geo block can lift)', async () => {
    const now = Date.now();
    fake = fakePocketBase({ tracks: [{ id: 'r1', external_id: 'youtube:gone0000001', unavailable_at: pbDate(now - UNAVAILABLE_RECHECK_MS - 1), unavailable_reason: 'geo' }] });
    expect(await freshUnavailableMark('youtube:gone0000001', now)).toBeNull();
  });

  it('a failed re-check writes a fresh date, so the window starts again', async () => {
    const now = Date.now();
    fake = fakePocketBase({ tracks: [{ id: 'r1', external_id: 'youtube:gone0000001', unavailable_at: pbDate(now - 2 * DAY), unavailable_reason: 'geo' }] });
    await markTrackUnavailable('youtube:gone0000001', 'geo');
    const row = fake.rows.get('tracks')![0];
    expect(Date.parse(String(row.unavailable_at))).toBeGreaterThan(now - 60_000);
  });

  it('the same reason again the same day costs no write', async () => {
    const now = Date.now();
    fake = fakePocketBase({ tracks: [{ id: 'r1', external_id: 'youtube:gone0000001', unavailable_at: pbDate(now - 60_000), unavailable_reason: 'removed' }] });
    await markTrackUnavailable('youtube:gone0000001', 'removed');
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('an unknown reason reads as plain "unavailable"', async () => {
    fake = fakePocketBase({ tracks: [{ id: 'r1', external_id: 'youtube:gone0000001', unavailable_at: pbDate(Date.now()), unavailable_reason: 'weird' }] });
    expect(await freshUnavailableMark('youtube:gone0000001')).toMatchObject({ reason: 'unavailable' });
  });
});
