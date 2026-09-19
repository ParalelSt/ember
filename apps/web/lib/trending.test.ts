import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrendingCache, DEFAULT_TRENDING_COUNTRIES, resolveTrendingCountries, resolveTrendingCountry, TRENDING_TTL_MS } from '@/lib/trending';
import { parseTrendingChart } from '@/lib/sources/youtube';

// player.py's real output for the chart captured on 2026-09-18 (see
// tests/test_player_trending.py, which builds the same list from the saved
// ytmusicapi responses).
const FIXTURE = path.resolve(__dirname, '../../../tests/fixtures/trending/player_trending_output.json');
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const parsed = parseTrendingChart(raw);

const HOUR = 60 * 60 * 1000;

describe('parseTrendingChart', () => {
  it('turns the saved player output into playable tracks in rank order', () => {
    expect(parsed.title).toBe('Daily Top Music Videos - Global');
    expect(parsed.source).toBe('ytmusicapi');
    expect(parsed.tracks).toHaveLength(50);
    expect(parsed.tracks.map((t) => t.sourceId)).toEqual(raw.tracks.map((t: { videoId: string }) => t.videoId));
    expect(parsed.tracks[0]).toMatchObject({
      id: 'youtube:fcnDmrtj6Sk',
      source: 'youtube',
      title: 'Dai Dai',
      artist: 'Shakira',
      durationSec: 241,
      streamUrl: '/api/youtube/stream/fcnDmrtj6Sk',
    });
  });

  it('keeps the first position of a duplicate and drops entries without a video id', () => {
    const [a, b] = raw.tracks;
    const out = parseTrendingChart({ tracks: [a, { ...b, videoId: '' }, b, a] });
    expect(out.tracks.map((t) => t.sourceId)).toEqual([a.videoId, b.videoId]);
  });

  it('still reads the old bare-array output', () => {
    expect(parseTrendingChart(raw.tracks.slice(0, 3)).tracks).toHaveLength(3);
  });
});

describe('resolveTrendingCountry', () => {
  it('accepts chart countries in any case', () => {
    expect(resolveTrendingCountry('DE')).toBe('DE');
    expect(resolveTrendingCountry(' at ')).toBe('AT');
  });

  it('falls back to the global chart for HR, junk and unset', () => {
    for (const bad of ['HR', 'xx', 'DEU', '../', '', undefined, null]) {
      expect(resolveTrendingCountry(bad)).toBe('ZZ');
    }
  });
});

describe('resolveTrendingCountries', () => {
  it('uses the default blend when neither env is set', () => {
    expect(resolveTrendingCountries(undefined, undefined)).toEqual(DEFAULT_TRENDING_COUNTRIES);
  });

  it('parses and uppercases a valid TRENDING_COUNTRIES list', () => {
    expect(resolveTrendingCountries('us, gb ,de', undefined)).toEqual(['US', 'GB', 'DE']);
  });

  it('drops unknown codes and warns, keeping the valid ones', () => {
    const warn = vi.fn();
    expect(resolveTrendingCountries('US,HR,GB', undefined, warn)).toEqual(['US', 'GB']);
    expect(warn).toHaveBeenCalledWith('trending: dropping unsupported TRENDING_COUNTRIES codes', { dropped: ['HR'] });
  });

  it('falls back to the default blend when nothing valid is left, with a warning', () => {
    const warn = vi.fn();
    expect(resolveTrendingCountries('HR,XX', undefined, warn)).toEqual(DEFAULT_TRENDING_COUNTRIES);
    expect(warn).toHaveBeenCalledWith('trending: no valid TRENDING_COUNTRIES codes left, using the default blend', { default: DEFAULT_TRENDING_COUNTRIES });
  });

  it('TRENDING_COUNTRY, single, wins over TRENDING_COUNTRIES for backward compatibility', () => {
    expect(resolveTrendingCountries('US,GB,DE,RS', 'DE')).toEqual(['DE']);
  });

  it('an invalid TRENDING_COUNTRY still wins (falls back to ZZ, not the blend)', () => {
    expect(resolveTrendingCountries('US,GB,DE,RS', 'HR')).toEqual(['ZZ']);
  });
});

describe('createTrendingCache', () => {
  let dir: string;
  let file: string;
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-trending-'));
    file = path.join(dir, 'trending.json');
    clock = Date.parse('2026-09-18T12:00:00Z');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function cache(fetchChart = vi.fn(async () => parsed), country = 'ZZ') {
    return { fetchChart, c: createTrendingCache({ fetchChart, cacheFile: file, country: () => country, now, retryMs: 0 }) };
  }

  it('fetches once on a cold start and mirrors the list to disk', async () => {
    const { fetchChart, c } = cache();
    const first = await c.get();
    expect(first).toMatchObject({ country: 'ZZ', stale: false, fetchedAt: '2026-09-18T12:00:00.000Z' });
    expect(first.tracks).toHaveLength(50);
    await c.get();
    expect(fetchChart).toHaveBeenCalledTimes(1);
    const mirrored = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(mirrored.tracks.map((t: { id: string }) => t.id)).toEqual(first.tracks.map((t) => t.id));
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchChart = vi.fn(async () => { await gate; return parsed; });
    const { c } = cache(fetchChart);
    const both = Promise.all([c.get(), c.get(), c.get()]);
    release();
    const results = await both;
    expect(fetchChart).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.tracks.length === 50)).toBe(true);
  });

  it('serves a fresh list without refetching inside the TTL', async () => {
    const { fetchChart, c } = cache();
    await c.get();
    clock += TRENDING_TTL_MS - 1;
    expect((await c.get()).stale).toBe(false);
    expect(fetchChart).toHaveBeenCalledTimes(1);
  });

  it('past the TTL serves the old list at once and refreshes in the background', async () => {
    const newer = { ...parsed, tracks: [...parsed.tracks].reverse() };
    const fetchChart = vi.fn().mockResolvedValueOnce(parsed).mockResolvedValueOnce(newer);
    const { c } = cache(fetchChart);
    await c.get();
    clock += TRENDING_TTL_MS + 1;
    const served = await c.get();
    expect(served.stale).toBe(true);
    expect(served.tracks[0].title).toBe('Dai Dai');
    await vi.waitFor(() => expect(fetchChart).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect((await c.get()).tracks[0].id).toBe(newer.tracks[0].id));
    expect((await c.get()).stale).toBe(false);
  });

  it('keeps the last good list, marked stale, when the source fails', async () => {
    const fetchChart = vi.fn().mockResolvedValueOnce(parsed).mockRejectedValue(new Error('HTTP 503'));
    const { c } = cache(fetchChart);
    const good = await c.get();
    clock += 13 * HOUR;
    await c.get();
    await vi.waitFor(() => expect(fetchChart).toHaveBeenCalledTimes(2));
    const after = await c.get();
    expect(after.stale).toBe(true);
    expect(after.fetchedAt).toBe(good.fetchedAt);
    expect(after.tracks.map((t) => t.id)).toEqual(good.tracks.map((t) => t.id));
  });

  it('an empty chart counts as a failure, not as the new list', async () => {
    const fetchChart = vi.fn().mockResolvedValueOnce(parsed).mockResolvedValue({ ...parsed, tracks: [] });
    const { c } = cache(fetchChart);
    await c.get();
    clock += TRENDING_TTL_MS + 1;
    await c.get();
    await vi.waitFor(() => expect(fetchChart).toHaveBeenCalledTimes(2));
    expect((await c.get()).tracks).toHaveLength(50);
  });

  it('cold start with a failing source gives an empty list and one warning', async () => {
    const warn = vi.fn();
    const fetchChart = vi.fn().mockRejectedValue(new Error('HTTP 503'));
    const c = createTrendingCache({ fetchChart, cacheFile: file, country: () => 'ZZ', now, warn });
    expect(await c.get()).toEqual({ country: 'ZZ', title: null, fetchedAt: null, source: [], stale: true, tracks: [] });
    // Inside the retry window the source is left alone.
    await c.get();
    expect(fetchChart).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('after a restart serves the mirrored list without fetching', async () => {
    await cache().c.get();
    const { fetchChart, c } = cache(vi.fn().mockRejectedValue(new Error('offline')));
    const got = await c.get();
    expect(got.tracks).toHaveLength(50);
    expect(got.stale).toBe(false);
    expect(fetchChart).not.toHaveBeenCalled();
  });

  it('ignores a mirror written for another country', async () => {
    await cache().c.get();
    const { fetchChart, c } = cache(vi.fn(async () => parsed), 'DE');
    expect((await c.get()).country).toBe('DE');
    expect(fetchChart).toHaveBeenCalledWith('DE');
  });

  it('preserves chart order end to end', async () => {
    const { c } = cache();
    const got = await c.get();
    expect(got.tracks.map((t) => t.title).slice(0, 5)).toEqual([
      'Dai Dai',
      'Jai Jai Ram',
      'Joseph',
      'Training Season (Live)',
      'SaWaDiKa (Official Music Video)',
    ]);
  });
});
