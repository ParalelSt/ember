// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { RadioBrowser, RawStation } from './radioBrowser';
import { createRadioService, LIST_TTL_MS, MISS_TTL_MS, NEARBY_CAP, NEARBY_MAX, roundCoord, toStation } from './service';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function raw(n: number, extra: Partial<RawStation> = {}): RawStation {
  return {
    stationuuid: ID(n),
    name: `Station ${n}`,
    url_resolved: `http://stream${n}.example/live`,
    favicon: `https://stream${n}.example/logo.png`,
    country: 'Croatia',
    countrycode: 'HR',
    state: 'Grad Zagreb',
    codec: 'MP3',
    bitrate: 128,
    votes: 10 * n,
    hls: 0,
    lastcheckok: 1,
    ...extra,
  };
}

/** A fake Radio Browser that records what it was asked. */
function fakeBrowser(lists: { search?: RawStation[]; byUuid?: RawStation[] } = {}) {
  const search = vi.fn<(params: Record<string, string>) => Promise<RawStation[]>>(async () => lists.search ?? []);
  const byUuid = vi.fn<(ids: string[]) => Promise<RawStation[]>>(async () => lists.byUuid ?? []);
  return { browser: { search, byUuid } satisfies RadioBrowser, search, byUuid };
}

describe('toStation', () => {
  it('maps a station and keeps its stream address apart from what players get', () => {
    const r = toStation(raw(1, { geo_distance: 12_345 }))!;
    expect(r.url).toBe('http://stream1.example/live');
    expect(r.station).toMatchObject({
      id: ID(1), name: 'Station 1', favicon: 'https://stream1.example/logo.png', countryCode: 'HR', codec: 'MP3', bitrate: 128, distanceKm: 12.3,
    });
    expect(r.station.track).toMatchObject({
      id: `station:${ID(1)}`, source: 'station', durationSec: 0, streamUrl: `/api/radio/stream/${ID(1)}`, artist: 'Grad Zagreb, Croatia',
    });
    expect(JSON.stringify(r.station)).not.toContain('stream1.example/live');
  });

  it('leaves out stations that cannot play here', () => {
    expect(toStation(raw(1, { lastcheckok: 0 }))).toBeNull();
    expect(toStation(raw(1, { hls: 1 }))).toBeNull();
    expect(toStation(raw(1, { codec: 'UNKNOWN' }))).toBeNull();
    expect(toStation(raw(1, { url_resolved: 'rtsp://x.example/a' }))).toBeNull();
    expect(toStation(raw(1, { url_resolved: 'http://user:pw@x.example/a' }))).toBeNull();
    expect(toStation(raw(1, { stationuuid: 'not-a-uuid' }))).toBeNull();
    expect(toStation(raw(1, { name: '  ' }))).toBeNull();
  });

  it('keeps only an https logo', () => {
    expect(toStation(raw(1, { favicon: 'http://x.example/l.png' }))!.station.favicon).toBeNull();
    expect(toStation(raw(1, { favicon: '' }))!.station.favicon).toBeNull();
    expect(toStation(raw(1, { favicon: 'javascript:alert(1)' }))!.station.favicon).toBeNull();
  });
});

describe('roundCoord', () => {
  it('rounds to a tenth of a degree', () => {
    expect(roundCoord(45.81444)).toBe(45.8);
    expect(roundCoord(15.97798)).toBe(16);
    expect(roundCoord(-0.04)).toBe(-0);
  });
});

describe('createRadioService', () => {
  it('asks for nearby stations at the rounded point and lists the nearest first', async () => {
    const f = fakeBrowser({ search: [raw(1, { geo_distance: 50_000 }), raw(2, { geo_distance: 3_000 }), raw(3, { geo_distance: 20_000 })] });
    const svc = createRadioService({ browser: f.browser });
    const list = await svc.nearby(45.81444, 15.97798);
    expect(list.map((s) => s.name)).toEqual(['Station 2', 'Station 3', 'Station 1']);
    const params = f.search.mock.calls[0][0];
    expect(params).toMatchObject({ geo_lat: '45.8', geo_long: '16.0', has_geo_info: 'true', hidebroken: 'true' });
    expect(Number(params.geo_distance)).toBeGreaterThan(0);
  });

  it('serves a list from memory for hours, and one fetch for two listeners asking at once', async () => {
    let t = 0;
    const f = fakeBrowser({ search: [raw(1)] });
    const svc = createRadioService({ browser: f.browser, now: () => t });
    await Promise.all([svc.country('hr'), svc.country('HR')]);
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(f.search.mock.calls[0][0]).toMatchObject({ countrycode: 'HR', order: 'votes', reverse: 'true' });
    t = LIST_TTL_MS - 1;
    await svc.country('HR');
    expect(f.search).toHaveBeenCalledTimes(1);
    t = LIST_TTL_MS + 1;
    await svc.country('HR');
    expect(f.search).toHaveBeenCalledTimes(2);
  });

  it('shares one cached list between two listeners in the same town', async () => {
    const f = fakeBrowser({ search: [raw(1)] });
    const svc = createRadioService({ browser: f.browser });
    await svc.nearby(45.811, 15.971);
    const asked = f.search.mock.calls.length;
    await svc.nearby(45.824, 15.989);
    expect(f.search).toHaveBeenCalledTimes(asked);
  });

  it('searches by name', async () => {
    const f = fakeBrowser({ search: [raw(1)] });
    const svc = createRadioService({ browser: f.browser });
    await svc.search('  Otvoreni ');
    expect(f.search.mock.calls[0][0]).toMatchObject({ name: 'Otvoreni', hidebroken: 'true' });
  });

  it('gives a stream address only for a station Radio Browser listed', async () => {
    const f = fakeBrowser({ search: [raw(1)], byUuid: [] });
    const svc = createRadioService({ browser: f.browser });
    await svc.country('HR');
    expect(await svc.streamTarget(ID(1))).toEqual({ url: 'http://stream1.example/live', codec: 'MP3' });
    expect(f.byUuid).not.toHaveBeenCalled();
    expect(await svc.streamTarget('not-an-id')).toBeNull();
    expect(await svc.streamTarget(ID(9))).toBeNull();
    expect(f.byUuid).toHaveBeenCalledWith([ID(9)]);
  });

  it('looks a station up by id when it is not in memory, and does not ask again for one it did not know', async () => {
    let t = 0;
    const f = fakeBrowser({ byUuid: [raw(4)] });
    const svc = createRadioService({ browser: f.browser, now: () => t });
    expect((await svc.station(ID(4)))?.name).toBe('Station 4');
    expect(svc.peek(ID(4))?.name).toBe('Station 4');
    f.byUuid.mockResolvedValue([]);
    expect(await svc.station(ID(5))).toBeNull();
    expect(await svc.station(ID(5))).toBeNull();
    expect(f.byUuid).toHaveBeenCalledTimes(2);
    t = MISS_TTL_MS + 1;
    await svc.station(ID(5));
    expect(f.byUuid).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failed fetch', async () => {
    const f = fakeBrowser();
    f.search.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 502 }));
    const svc = createRadioService({ browser: f.browser });
    await expect(svc.country('HR')).rejects.toMatchObject({ status: 502 });
    f.search.mockResolvedValueOnce([raw(1)]);
    expect(await svc.country('HR')).toHaveLength(1);
  });
});

describe('nearby, with the stations that have no coordinates', () => {
  const geo = (n: number, km: number, extra: Partial<RawStation> = {}) =>
    raw(n, { geo_lat: 45.8, geo_long: 16, geo_distance: km * 1000, ...extra });

  /** Answers the radius search with `around` and the country search with
   *  `country`, as Radio Browser would. */
  function browserFor(around: RawStation[], country: RawStation[]) {
    const search = vi.fn<(params: Record<string, string>) => Promise<RawStation[]>>(async (p) => (p.countrycode ? country : around));
    const byUuid = vi.fn<(ids: string[]) => Promise<RawStation[]>>(async () => []);
    return { browser: { search, byUuid } satisfies RadioBrowser, search };
  }

  it('adds the country\'s stations with no coordinates, each beside its own region, with no distance', async () => {
    const around = [
      geo(1, 2, { state: 'Grad Zagreb' }),
      geo(2, 40, { state: 'Krapinsko-zagorska' }),
      geo(3, 9, { state: 'Grad Zagreb' }),
      geo(4, 150, { state: 'Istarska', countrycode: 'SI' }),
    ];
    const country = [
      raw(10, { name: 'Antena Zagreb', state: 'Grad Zagreb', votes: 900 }),
      raw(11, { name: 'Zagorje radio', state: 'krapinsko-zagorska ', votes: 5 }),
      raw(12, { name: 'Split radio', state: 'Splitsko-dalmatinska', votes: 2_000 }),
      raw(13, { name: 'Nowhere FM', state: '', votes: 1 }),
      // Has coordinates, so the radius already judged it too far.
      raw(14, { name: 'Far away', state: 'Grad Zagreb', geo_lat: 42.6, geo_long: 18.1, votes: 5_000 }),
    ];
    const f = browserFor(around, country);
    const list = await createRadioService({ browser: f.browser }).nearby(45.81, 15.97);

    expect(f.search.mock.calls[1][0]).toMatchObject({ countrycode: 'HR', hidebroken: 'true', order: 'votes', reverse: 'true' });
    expect(list.map((s) => s.name)).toEqual([
      'Antena Zagreb', // Grad Zagreb's nearest is 2 km; the most votes there
      'Station 1',
      'Station 3',
      'Station 2',
      'Zagorje radio', // beside Krapinsko-zagorska, 40 km
      'Station 4',
      'Split radio', // no region around: the rest, by votes
      'Nowhere FM',
    ]);
    expect(list.find((s) => s.name === 'Antena Zagreb')!.distanceKm).toBeNull();
    expect(list.find((s) => s.name === 'Station 1')!.distanceKm).toBe(2);
  });

  it('keeps the measured version of a station both searches list', async () => {
    const f = browserFor([geo(1, 5)], [raw(1)]);
    const list = await createRadioService({ browser: f.browser }).nearby(45.81, 15.97);
    expect(list).toHaveLength(1);
    expect(list[0].distanceKm).toBe(5);
  });

  it('fills up to a hundred stations with the country\'s others', async () => {
    const around = Array.from({ length: 60 }, (_, i) => geo(i + 1, i + 1, { state: 'Grad Zagreb' }));
    const country = Array.from({ length: 200 }, (_, i) => raw(1_000 + i, { state: 'Elsewhere' }));
    const f = browserFor(around, country);
    const list = await createRadioService({ browser: f.browser }).nearby(45.81, 15.97);
    expect(list).toHaveLength(NEARBY_MAX);
    expect(list.filter((s) => s.distanceKm !== null)).toHaveLength(60);
    // The best voted of the rest.
    expect(list[60].name).toBe('Station 1199');
  });

  it('never drops a station around, and stops a crowded region at the cap', async () => {
    const around = Array.from({ length: 90 }, (_, i) => geo(i + 1, i + 1, { state: i < 10 ? 'Grad Zagreb' : 'Far' }));
    const country = Array.from({ length: 100 }, (_, i) => raw(1_000 + i, { state: i % 2 ? 'Grad Zagreb' : 'Elsewhere' }));
    const f = browserFor(around, country);
    const list = await createRadioService({ browser: f.browser }).nearby(45.81, 15.97);
    // 90 around and 50 of Grad Zagreb: past a hundred, but none of them is cut.
    expect(list).toHaveLength(140);
    expect(list.every((s) => s.state !== 'Elsewhere')).toBe(true);

    const crowded = browserFor(around, Array.from({ length: 300 }, (_, i) => raw(2_000 + i, { state: 'Grad Zagreb' })));
    const capped = await createRadioService({ browser: crowded.browser }).nearby(45.81, 15.97);
    expect(capped).toHaveLength(NEARBY_CAP);
    expect(capped.filter((s) => s.distanceKm !== null)).toHaveLength(90);
    // The region's best voted made it, the least voted did not.
    expect(capped.some((s) => s.name === 'Station 2299')).toBe(true);
    expect(capped.some((s) => s.name === 'Station 2000')).toBe(false);
  });

  it('asks for no country when nothing is around', async () => {
    const f = browserFor([], [raw(1)]);
    expect(await createRadioService({ browser: f.browser }).nearby(0, 0)).toEqual([]);
    expect(f.search).toHaveBeenCalledTimes(1);
  });

  it('still lists the stations around when the country search fails', async () => {
    const f = browserFor([geo(1, 5)], []);
    f.search.mockImplementation(async (p) => {
      if (p.countrycode) throw Object.assign(new Error('down'), { status: 502 });
      return [geo(1, 5)];
    });
    const list = await createRadioService({ browser: f.browser }).nearby(45.81, 15.97);
    expect(list.map((s) => s.name)).toEqual(['Station 1']);
  });

  it('caches the whole list: two searches once, then none', async () => {
    const f = browserFor([geo(1, 5)], [raw(2)]);
    const svc = createRadioService({ browser: f.browser });
    await Promise.all([svc.nearby(45.81, 15.97), svc.nearby(45.82, 15.98)]);
    await svc.nearby(45.81, 15.97);
    expect(f.search).toHaveBeenCalledTimes(2);
  });
});
