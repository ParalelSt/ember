import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Track } from '@/types/track';
import { fetchGenreCharts, MUSIC_DIR, type GenreChartFetch } from '@/lib/sources/youtube';
import { serverLogger } from '@/lib/logger/server';
import { chartOrder } from '@/lib/genres/taxonomy';

/** The genre charts ("Charts by genre"), cached per server like the trending
 *  chart (lib/trending.ts, docs/trending.md), keyed by chart slug.
 *
 *  One player run fetches all of them (about 11 YouTube calls, 3 s apart),
 *  so a page load never does: the charts live in memory, mirrored to
 *  MUSIC_DIR/charts.json so a restart serves them at once. A day after the
 *  last good run they are served straight away and refreshed in the
 *  background, one run at a time. A chart that fails in a run keeps its last
 *  good list, marked stale once that is past the TTL; when the whole run
 *  fails, everything is kept and the source is tried again after
 *  CHARTS_RETRY_MS. */

export const CHARTS_TTL_MS = 24 * 60 * 60 * 1000;
export const CHARTS_RETRY_MS = 5 * 60 * 1000;

export interface ChartEntry {
  slug: string;
  title: string;
  playlistId: string | null;
  /** ISO time of the run this chart's list came from. */
  fetchedAt: string;
  /** Rank order: position 0 is number 1. */
  tracks: Track[];
}

interface Mirror {
  /** ISO time of the last run that brought back at least one chart. */
  refreshedAt: string;
  charts: ChartEntry[];
}

export interface ChartResult extends ChartEntry {
  /** Past the TTL (its source could not refresh it yet). */
  stale: boolean;
}

interface Deps {
  fetchCharts: () => Promise<{ charts: GenreChartFetch[]; failed: string[] }>;
  /** Mirror file; null keeps the cache in memory only. */
  cacheFile: string | null;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
  /** Called after every run that brought charts back (the genre tagger
   *  takes chart artists as weak priors from here). Errors are ignored. */
  onRefresh?: (charts: ChartEntry[]) => void | Promise<void>;
}

function readMirror(file: string | null): Mirror | null {
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Mirror;
    if (!data?.refreshedAt || !Array.isArray(data.charts)) return null;
    const charts = data.charts.filter((c) => c && typeof c.slug === 'string' && Array.isArray(c.tracks) && c.fetchedAt);
    return { refreshedAt: data.refreshedAt, charts };
  } catch {
    return null;
  }
}

function writeMirror(file: string | null, mirror: Mirror) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mirror));
    fs.renameSync(tmp, file);
  } catch {
    // The memory copy still works; the mirror only helps after a restart.
  }
}

const sortCharts = (charts: ChartEntry[]) =>
  [...charts].sort((a, b) => chartOrder(a.slug) - chartOrder(b.slug) || a.slug.localeCompare(b.slug));

export function createChartsCache(deps: Deps) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? CHARTS_TTL_MS;
  const retryMs = deps.retryMs ?? CHARTS_RETRY_MS;
  const warn = deps.warn ?? (() => {});

  let mirror: Mirror | null = null;
  let loaded = false;
  let inFlight: Promise<Mirror | null> | null = null;
  let lastFailure = -Infinity;

  function refresh(): Promise<Mirror | null> {
    if (inFlight) return inFlight;
    inFlight = deps.fetchCharts()
      .then((got) => {
        if (got.charts.length === 0) throw new Error('no chart came back');
        const at = new Date(now()).toISOString();
        const bySlug = new Map((mirror?.charts ?? []).map((c) => [c.slug, c]));
        for (const c of got.charts) {
          bySlug.set(c.slug, { slug: c.slug, title: c.title, playlistId: c.playlistId, fetchedAt: at, tracks: c.tracks });
        }
        if (got.failed.length) warn('charts: some charts failed, keeping their last good lists', { failed: got.failed });
        mirror = { refreshedAt: at, charts: sortCharts([...bySlug.values()]) };
        writeMirror(deps.cacheFile, mirror);
        if (deps.onRefresh) {
          try {
            void Promise.resolve(deps.onRefresh(mirror.charts)).catch(() => {});
          } catch {
            // A failing listener never costs the charts.
          }
        }
        return mirror;
      })
      .catch((e: unknown) => {
        lastFailure = now();
        warn(mirror ? 'charts: refresh failed, serving the last good charts' : 'charts: no charts yet and the source failed', {
          reason: e instanceof Error ? e.message : String(e),
        });
        return mirror;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  function withStale(c: ChartEntry): ChartResult {
    return { ...c, stale: !(now() - Date.parse(c.fetchedAt) < ttlMs) };
  }

  /** Every chart, in Home order. Cold start waits for the source. */
  async function getAll(): Promise<{ refreshedAt: string | null; charts: ChartResult[] }> {
    if (!loaded) {
      mirror = readMirror(deps.cacheFile);
      loaded = true;
    }
    const canRetry = now() - lastFailure >= retryMs;
    if (!mirror) {
      const got = canRetry || inFlight ? await refresh() : null;
      return { refreshedAt: got?.refreshedAt ?? null, charts: (got?.charts ?? []).map(withStale) };
    }
    const age = now() - Date.parse(mirror.refreshedAt);
    if (!(age < ttlMs) && canRetry) void refresh();
    return { refreshedAt: mirror.refreshedAt, charts: mirror.charts.map(withStale) };
  }

  async function get(slug: string): Promise<ChartResult | null> {
    const all = await getAll();
    return all.charts.find((c) => c.slug === slug) ?? null;
  }

  return { getAll, get };
}

const SHARED = Symbol.for('ember.chartsCache');
type ChartsCache = ReturnType<typeof createChartsCache>;
type ChartsGlobal = typeof globalThis & { [SHARED]?: ChartsCache };

/** The server's charts cache (one per process, survives hot reloads). */
export function chartsCache(): ChartsCache {
  const g = globalThis as ChartsGlobal;
  g[SHARED] ??= createChartsCache({
    fetchCharts: fetchGenreCharts,
    cacheFile: path.join(MUSIC_DIR, 'charts.json'),
    warn: (message, detail) => serverLogger.warn('charts', message, detail),
    // Chart artists become weak genre priors (lib/genres/tagger.ts).
    onRefresh: async (charts) => {
      try {
        const { genreTagger } = await import('@/lib/genres/instance');
        const written = await genreTagger().applyChartPriors(charts);
        if (written) serverLogger.info('charts', 'chart artists added as genre priors', { written });
      } catch (e) {
        serverLogger.warn('charts', 'could not add chart artists as genre priors', { reason: e instanceof Error ? e.message : String(e) });
      }
    },
  });
  return g[SHARED];
}

/** Up to `n` distinct cover images from the top of a list. */
export function topArtworks(tracks: readonly Track[], n: number): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    if (t.artworkUrl && !out.includes(t.artworkUrl)) out.push(t.artworkUrl);
    if (out.length >= n) break;
  }
  return out;
}
