import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Track } from '@/types/track';
import { fetchTrendingChart, MUSIC_DIR } from '@/lib/sources/youtube';
import { serverLogger } from '@/lib/logger/server';

/** Today's YouTube Music chart, cached per server. See docs/trending.md.
 *
 *  The chart changes once a day, and a second YouTube call within a second
 *  has answered HTTP 503, so a page load never fetches it. The list lives in
 *  memory, mirrored to MUSIC_DIR/trending.json so a restart serves it at
 *  once. Past the TTL it is served straight away and refreshed in the
 *  background, one refresh at a time. When the source fails the last good
 *  list keeps being served, marked stale. */

export const TRENDING_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed refresh, wait this long before trying the source again. */
export const TRENDING_RETRY_MS = 5 * 60 * 1000;

/** Countries YouTube Music has charts for (get_charts `countries.options`,
 *  2026-09-18). ZZ is the global chart. Croatia is not among them. */
export const TRENDING_COUNTRIES = new Set([
  'ZZ', 'AR', 'AU', 'AT', 'BE', 'BO', 'BR', 'CA', 'CL', 'CO', 'CR', 'CZ', 'DK', 'DO', 'EC', 'EG', 'SV',
  'EE', 'FI', 'FR', 'DE', 'GT', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IE', 'IL', 'IT', 'JP', 'KE', 'LU',
  'MY', 'MX', 'NL', 'NZ', 'NI', 'NG', 'NO', 'PA', 'PY', 'PE', 'PH', 'PL', 'PT', 'RO', 'RU', 'SA', 'RS',
  'SG', 'ZA', 'KR', 'ES', 'SE', 'CH', 'TW', 'TZ', 'TH', 'TR', 'UG', 'UA', 'AE', 'GB', 'US', 'UY', 'VN',
  'ZW',
]);

/** TRENDING_COUNTRY as a chart country: unset, unknown (HR) or junk gives ZZ. */
export function resolveTrendingCountry(raw: string | undefined | null): string {
  const code = String(raw ?? '').trim().toUpperCase();
  return TRENDING_COUNTRIES.has(code) ? code : 'ZZ';
}

export interface TrendingChart {
  country: string;
  /** ISO time of the fetch this list came from. */
  fetchedAt: string;
  source: string;
  title: string | null;
  /** Rank order: position 0 is number 1. */
  tracks: Track[];
}

export interface TrendingResult {
  country: string;
  title: string | null;
  fetchedAt: string | null;
  /** True when this list is past its TTL (the source could not refresh it
   *  yet) or there is none at all. */
  stale: boolean;
  tracks: Track[];
}

interface Deps {
  fetchChart: (country: string) => Promise<{ title: string | null; source: string; tracks: Track[] }>;
  /** Mirror file; null keeps the cache in memory only. */
  cacheFile: string | null;
  country: () => string;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
}

function readMirror(file: string | null, country: string): TrendingChart | null {
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as TrendingChart;
    if (data?.country !== country || !Array.isArray(data.tracks) || !data.fetchedAt) return null;
    return data;
  } catch {
    return null;
  }
}

function writeMirror(file: string | null, chart: TrendingChart) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(chart));
    fs.renameSync(tmp, file);
  } catch {
    // The memory copy still works; the mirror only helps after a restart.
  }
}

export function createTrendingCache(deps: Deps) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? TRENDING_TTL_MS;
  const retryMs = deps.retryMs ?? TRENDING_RETRY_MS;
  const warn = deps.warn ?? (() => {});

  let chart: TrendingChart | null = null;
  let loadedFor: string | null = null;
  let inFlight: Promise<TrendingChart | null> | null = null;
  let lastFailure = -Infinity;

  function refresh(country: string): Promise<TrendingChart | null> {
    if (inFlight) return inFlight;
    inFlight = deps.fetchChart(country)
      .then((got) => {
        if (got.tracks.length === 0) throw new Error('the chart came back empty');
        chart = { country, fetchedAt: new Date(now()).toISOString(), source: got.source, title: got.title, tracks: got.tracks };
        writeMirror(deps.cacheFile, chart);
        return chart;
      })
      .catch((e: unknown) => {
        lastFailure = now();
        warn(chart ? 'trending: refresh failed, serving the last good chart' : 'trending: no chart yet and the source failed', {
          reason: e instanceof Error ? e.message : String(e),
        });
        return chart;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  function result(country: string, c: TrendingChart | null): TrendingResult {
    if (!c) return { country, title: null, fetchedAt: null, stale: true, tracks: [] };
    const age = now() - Date.parse(c.fetchedAt);
    return { country, title: c.title, fetchedAt: c.fetchedAt, stale: !(age < ttlMs), tracks: c.tracks };
  }

  async function get(): Promise<TrendingResult> {
    const country = deps.country();
    if (loadedFor !== country) {
      chart = readMirror(deps.cacheFile, country);
      loadedFor = country;
      lastFailure = -Infinity;
    }
    const canRetry = now() - lastFailure >= retryMs;
    if (!chart) {
      // Cold start: nothing to show, so wait for the source (or its failure).
      return result(country, canRetry || inFlight ? await refresh(country) : null);
    }
    const age = now() - Date.parse(chart.fetchedAt);
    if (!(age < ttlMs) && canRetry) void refresh(country);
    return result(country, chart);
  }

  return { get };
}

let shared: ReturnType<typeof createTrendingCache> | null = null;

/** The server's chart cache, for the country TRENDING_COUNTRY names. */
export function getTrendingChart(): Promise<TrendingResult> {
  shared ??= createTrendingCache({
    fetchChart: fetchTrendingChart,
    cacheFile: path.join(MUSIC_DIR, 'trending.json'),
    country: () => resolveTrendingCountry(process.env.TRENDING_COUNTRY),
    warn: (message, detail) => serverLogger.warn('trending', message, detail),
  });
  return shared.get();
}
