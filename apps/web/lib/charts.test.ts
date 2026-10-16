import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTS_TTL_MS, createChartsCache, topArtworks } from '@/lib/charts';
import { parseGenreCharts, type GenreChartFetch } from '@/lib/sources/youtube';
import type { Track } from '@/types/track';

const HOUR = 60 * 60 * 1000;

const track = (id: string, art: string | null = `https://img/${id}`): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title: `Song ${id}`, artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 200, artworkUrl: art, streamUrl: `/api/youtube/stream/${id}`,
});

const chart = (slug: string, ids: string[]): GenreChartFetch => ({ slug, title: slug, playlistId: `PL${slug}`, tracks: ids.map((i) => track(i)) });

let dir: string;
let file: string;
let clock: number;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-charts-'));
  file = path.join(dir, 'charts.json');
  clock = Date.parse('2026-10-16T08:00:00Z');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function make(fetchCharts: () => Promise<{ charts: GenreChartFetch[]; failed: string[] }>, extra: Partial<Parameters<typeof createChartsCache>[0]> = {}) {
  return createChartsCache({ fetchCharts, cacheFile: file, now: () => clock, ...extra });
}

describe('createChartsCache', () => {
  it('cold start waits for the source, orders charts by the taxonomy, writes the mirror', async () => {
    const fetchCharts = vi.fn(async () => ({ charts: [chart('rock', ['rock0000001']), chart('balkan', ['balk0000001']), chart('zzz-new', ['zzzz0000001'])], failed: [] }));
    const cache = make(fetchCharts);
    const all = await cache.getAll();
    expect(all.charts.map((c) => c.slug)).toEqual(['balkan', 'rock', 'zzz-new']);
    expect(all.charts.every((c) => !c.stale)).toBe(true);
    expect(fetchCharts).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).charts).toHaveLength(3);
  });

  it('serves from memory inside the TTL without asking the source again', async () => {
    const fetchCharts = vi.fn(async () => ({ charts: [chart('rock', ['rock0000001'])], failed: [] }));
    const cache = make(fetchCharts);
    await cache.getAll();
    clock += 23 * HOUR;
    await cache.getAll();
    expect(fetchCharts).toHaveBeenCalledTimes(1);
  });

  it('past the TTL serves the old lists marked stale and refreshes in the background, once', async () => {
    let n = 0;
    const fetchCharts = vi.fn(async () => ({ charts: [chart('rock', [n++ === 0 ? 'rock0000001' : 'rock0000002'])], failed: [] }));
    const cache = make(fetchCharts);
    await cache.getAll();
    clock += CHARTS_TTL_MS + 1;
    const [a, b] = await Promise.all([cache.getAll(), cache.getAll()]);
    expect(a.charts[0].stale).toBe(true);
    expect(a.charts[0].tracks[0].sourceId).toBe('rock0000001');
    expect(b.charts[0].tracks[0].sourceId).toBe('rock0000001');
    await vi.waitFor(() => expect(fetchCharts).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    const c = await cache.getAll();
    expect(c.charts[0].tracks[0].sourceId).toBe('rock0000002');
    expect(c.charts[0].stale).toBe(false);
  });

  it('a chart that failed keeps its last good list and goes stale on its own', async () => {
    let run = 0;
    const fetchCharts = vi.fn(async () => {
      run++;
      if (run === 1) return { charts: [chart('rock', ['rock0000001']), chart('pop', ['pop00000001'])], failed: [] };
      return { charts: [chart('pop', ['pop00000002'])], failed: ['rock'] };
    });
    const warn = vi.fn();
    const cache = make(fetchCharts, { warn });
    await cache.getAll();
    clock += CHARTS_TTL_MS + 1;
    await cache.getAll();
    await vi.waitFor(() => expect(fetchCharts).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    const all = await cache.getAll();
    const rock = all.charts.find((c) => c.slug === 'rock')!;
    const pop = all.charts.find((c) => c.slug === 'pop')!;
    expect(rock.tracks[0].sourceId).toBe('rock0000001');
    expect(rock.stale).toBe(true);
    expect(pop.tracks[0].sourceId).toBe('pop00000002');
    expect(pop.stale).toBe(false);
    expect(warn).toHaveBeenCalledWith('charts: some charts failed, keeping their last good lists', { failed: ['rock'] });
    // The run itself worked, so the cache does not hammer the source for rock.
    clock += HOUR;
    await cache.getAll();
    expect(fetchCharts).toHaveBeenCalledTimes(2);
  });

  it('a restart serves the mirror at once', async () => {
    await make(async () => ({ charts: [chart('rock', ['rock0000001'])], failed: [] })).getAll();
    const fetchCharts = vi.fn(async () => ({ charts: [], failed: [] }));
    const again = make(fetchCharts);
    const all = await again.getAll();
    expect(all.charts.map((c) => c.slug)).toEqual(['rock']);
    expect(fetchCharts).not.toHaveBeenCalled();
  });

  it('a corrupt mirror is a cold start', async () => {
    fs.writeFileSync(file, '{not json');
    const fetchCharts = vi.fn(async () => ({ charts: [chart('rock', ['rock0000001'])], failed: [] }));
    expect((await make(fetchCharts).getAll()).charts).toHaveLength(1);
  });

  it('cold start with the source down answers empty, then waits CHARTS_RETRY_MS before trying again', async () => {
    const fetchCharts = vi.fn(async () => { throw new Error('HTTP 503'); });
    const warn = vi.fn();
    const cache = make(fetchCharts, { warn, retryMs: 5 * 60_000 });
    expect(await cache.getAll()).toEqual({ refreshedAt: null, charts: [] });
    await cache.getAll();
    expect(fetchCharts).toHaveBeenCalledTimes(1);
    clock += 5 * 60_000;
    await cache.getAll();
    expect(fetchCharts).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('charts: no charts yet and the source failed', { reason: 'HTTP 503' });
  });

  it('a whole run failing keeps every chart', async () => {
    let run = 0;
    const fetchCharts = vi.fn(async () => {
      if (++run === 1) return { charts: [chart('rock', ['rock0000001'])], failed: [] };
      throw new Error('down');
    });
    const cache = make(fetchCharts);
    await cache.getAll();
    clock += CHARTS_TTL_MS + 1;
    await cache.getAll();
    await vi.waitFor(() => expect(fetchCharts).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    const all = await cache.getAll();
    expect(all.charts[0].tracks[0].sourceId).toBe('rock0000001');
    expect(all.charts[0].stale).toBe(true);
  });

  it('get(slug) finds one chart, null for an unknown one', async () => {
    const cache = make(async () => ({ charts: [chart('rock', ['rock0000001'])], failed: [] }));
    expect((await cache.get('rock'))?.tracks).toHaveLength(1);
    expect(await cache.get('nope')).toBeNull();
  });

  it('tells onRefresh about each good run, and a failing listener costs nothing', async () => {
    const onRefresh = vi.fn(async () => { throw new Error('listener down'); });
    const cache = make(async () => ({ charts: [chart('rock', ['rock0000001'])], failed: [] }), { onRefresh });
    const all = await cache.getAll();
    expect(all.charts).toHaveLength(1);
    expect(onRefresh).toHaveBeenCalledWith([expect.objectContaining({ slug: 'rock' })]);
  });
});

describe('parseGenreCharts', () => {
  it('drops bad slugs, bad ids, duplicates and empty charts', () => {
    const raw = {
      charts: [
        { slug: 'rock', title: 'Rock', playlistId: 'PL1', tracks: [
          { videoId: 'aaaaaaaaaaa', title: 'A', artist: 'X', artworkUrl: '' },
          { videoId: 'bad', title: 'B', artist: 'X', artworkUrl: '' },
          { videoId: 'aaaaaaaaaaa', title: 'A again', artist: 'X', artworkUrl: '' },
        ] },
        { slug: '../etc', title: 'Bad', tracks: [{ videoId: 'ccccccccccc', title: 'C', artist: 'X', artworkUrl: '' }] },
        { slug: 'pop', title: 'Pop', tracks: [] },
      ],
      failed: ['jazz', 3],
    };
    const out = parseGenreCharts(raw as never);
    expect(out.charts.map((c) => c.slug)).toEqual(['rock']);
    expect(out.charts[0].tracks.map((t) => t.id)).toEqual(['youtube:aaaaaaaaaaa']);
    expect(out.failed).toEqual(['jazz']);
    expect(parseGenreCharts(null)).toEqual({ charts: [], failed: [] });
  });
});

describe('topArtworks', () => {
  it('takes distinct covers from the top, skipping missing ones', () => {
    const list = [track('a', 'x'), track('b', null), track('c', 'x'), track('d', 'y'), track('e', 'z')];
    expect(topArtworks(list, 2)).toEqual(['x', 'y']);
  });
});
