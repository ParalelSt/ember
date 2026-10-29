import { describe, expect, it, vi } from 'vitest';
import { createAutoCacheDriver } from './driver';
import type { CacheAdapter } from './adapter';
import { makeTrack } from '@/test-utils/fakeBackend';
import { stationTrack } from '@/lib/radio/station';

/** A live radio station has no end: the auto cache must never try to
 *  download one ahead (it would never finish), and passes over it to the
 *  next song that can be cached. */

function fakeAdapter() {
  const prefetch = vi.fn(async () => ({ kind: 'ok' as const, bytes: 10 }));
  const adapter = {
    writesThrough: false,
    entries: () => new Map(),
    stats: () => ({ bytes: 0, count: 0, cap: 1_000_000_000 }),
    has: () => false,
    prefetch,
    evict: vi.fn(async () => {}),
    touch: vi.fn(),
  } as unknown as CacheAdapter;
  return { adapter, prefetch };
}

const S1 = stationTrack({ id: '00000000-0000-4000-8000-000000000001', name: 'One', favicon: null });
const S2 = stationTrack({ id: '00000000-0000-4000-8000-000000000002', name: 'Two', favicon: null });
const SONG = makeTrack({ id: 'youtube:aaaaaaaaaaa', sourceId: 'aaaaaaaaaaa', streamUrl: '/api/youtube/stream/aaaaaaaaaaa', durationSec: 10 });

function drive(queue: ReturnType<typeof makeTrack>[]) {
  const { adapter, prefetch } = fakeAdapter();
  const driver = createAutoCacheDriver({
    adapter,
    player: () => ({ queue, index: 0, loopMode: 'off', context: null, baseCount: queue.length, playing: true }),
    playback: () => ({ playedSec: 600, bufferedToEnd: true }),
    conditions: () => ({ online: true, metered: false, saveData: false, batterySaver: false }),
    settings: () => ({ enabled: true }),
    now: () => 1_000,
  });
  driver.tick();
  return { driver, prefetch };
}

describe('auto cache and live stations', () => {
  it('downloads no station of a station list', async () => {
    const { driver, prefetch } = drive([S1, S2]);
    await Promise.resolve();
    expect(prefetch).not.toHaveBeenCalled();
    driver.dispose();
  });

  it('passes a station over to the song after it', async () => {
    const { driver, prefetch } = drive([SONG, S1, { ...SONG, id: 'youtube:bbbbbbbbbbb', sourceId: 'bbbbbbbbbbb', streamUrl: '/api/youtube/stream/bbbbbbbbbbb' }]);
    await vi.waitFor(() => expect(prefetch).toHaveBeenCalled());
    const ids = prefetch.mock.calls.map((c) => (c as unknown as [{ id: string }])[0].id);
    expect(ids).not.toContain(S1.id);
    driver.dispose();
  });
});
