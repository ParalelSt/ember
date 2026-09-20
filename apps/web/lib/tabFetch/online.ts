import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';
import { FETCHED_DIR, newTabFilename } from '@/lib/tabs';
import { songKeyOf } from '@/lib/tabStore';
import {
  chooseUg,
  parseUgSearch,
  parseUgTabPage,
  ugQuery,
  ugSearchUrl,
  ugTabToAlphaTex,
  type UgPart,
  type UgResult,
} from '@/lib/tabFetch/ug';
import {
  chooseSongsterrSongs,
  chooseSongsterrTracks,
  parseSongsterrPage,
  parseSongsterrSearch,
  partUrl,
  readSongsterrPart,
  songsterrPageUrl,
  songsterrToAlphaTex,
  trackLabel,
  type SongsterrHit,
  type SongsterrPart,
  type SongsterrTrack,
} from '@/lib/songsterrPart';
import { DEFAULT_GAP_MS, FetchStatusError, PoliteFetcher, SiteBackoffError } from '@/lib/tabFetch/polite';

/** Ember looks for a song's tab online (docs/tabs-v3.md, stages 3 and 4),
 *  once per song, and keeps what it found in the shared store:
 *
 *   - Songsterr first: the song page's state and the notes of its guitar
 *     and bass parts (lib/songsterrPart.ts), one multi-track alphaTex, a
 *     `tabs` row (kind "fetched", source_site "songsterr"), files in
 *     MUSIC_DIR/tabs/fetched (`.alphatex` and the parts as `.json`);
 *   - then Ultimate Guitar's text tabs: a row per tab (source_site "ug"),
 *     `.alphatex` beside the tab text `.txt`;
 *   - a `tab_lookups` row per song and site: "found" or "none". With one,
 *     the site is never searched for the song again on its own; "Search
 *     online again" (`again`) is the only way.
 *
 *  Polite: one queue per site for the whole server (lib/tabFetch/polite.ts:
 *  2 s between requests, an hour's pause on 429/403/503). Per song:
 *  Songsterr's search, its song page and at most MAX_PARTS part files from
 *  its CDN (a queue of its own, as it is another host); UG's search and at
 *  most MAX_TAB_PAGES tab pages. Two people opening the same song share one
 *  search.
 *
 *  Quiet: a failure is logged and that site is left unrecorded for the
 *  song, so the page simply shows its other sources and the next opening
 *  tries again (after any pause). Nothing here throws to the caller. */

export const UG_SITE = 'ug';
export const SONGSTERR_SITE = 'songsterr';
/** Songsterr's part files come from its CDN, another host with its own
 *  queue. */
export const SONGSTERR_CDN_SITE = 'songsterr-cdn';
export type OnlineSite = typeof SONGSTERR_SITE | typeof UG_SITE;
/** Searched in this order: Songsterr has real rhythm and every instrument. */
export const ONLINE_SITES: OnlineSite[] = [SONGSTERR_SITE, UG_SITE];

/** Tab pages fetched per song, at most: the best guitar tab and the best
 *  bass tab, so both pickers have one, with the search that makes three
 *  requests per song (the plan's ceiling). A page that does not parse
 *  spends its turn: the next candidate is tried only while turns remain. */
export const MAX_TAB_PAGES = 2;

/** Candidates kept on the lookup row for the picker (round 3). */
const KEEP_RESULTS = 8;

export function ugBase(): string {
  return (process.env.UG_BASE || 'https://www.ultimate-guitar.com').replace(/\/+$/, '');
}

export function songsterrBase(): string {
  return (process.env.SONGSTERR_BASE || 'https://www.songsterr.com').replace(/\/+$/, '');
}

export function songsterrCdnBase(): string {
  return (process.env.SONGSTERR_CDN_BASE || 'https://dqsljvtekg760.cloudfront.net').replace(/\/+$/, '');
}

/** The URL to fetch for a tab page. The search hands out UG's own
 *  (tabs.ultimate-guitar.com); with UG_BASE set (tests) the path is served
 *  by the fake instead. */
export function tabPageUrl(url: string): string {
  if (!process.env.UG_BASE) return url;
  const u = new URL(url);
  return `${ugBase()}${u.pathname}${u.search}`;
}

let shared: PoliteFetcher | null = null;
/** The server's one queue for the tab sites. */
export function tabFetcher(): PoliteFetcher {
  if (!shared) {
    const gap = Number(process.env.TAB_FETCH_GAP_MS);
    shared = new PoliteFetcher({ gapMs: Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_GAP_MS });
  }
  return shared;
}

export type OnlineStatus = 'found' | 'none' | 'cached' | 'failed';

export interface OnlineResult {
  status: OnlineStatus;
  /** When the song was last searched (the lookup rows), if it has been. */
  searchedAt: string | null;
  /** Tabs added by this call. */
  added: number;
}

export interface OnlineSong {
  title: string;
  artist: string;
  trackId: string;
}

export interface OnlineDeps {
  fetcher?: PoliteFetcher;
  /** Ultimate Guitar's base URL. */
  base?: string;
  songsterrBase?: string;
  songsterrCdn?: string;
  /** Which sites to search, in order (default ONLINE_SITES). */
  sites?: OnlineSite[];
  now?: () => Date;
  /** Where the files go (tests use a temp dir). */
  dir?: string;
  /** A freshly signed-in admin client for each write. The search can wait
   *  in the site's queue for a long time and is shared by every request
   *  for the song, so it does not lean on the client of the request that
   *  started it (the sandbox saw that client go signed-out mid-search).
   *  Tests leave it out and write through `pb`. */
  freshPb?: () => Promise<PocketBase>;
  /** Called with every row this search added (the route lines them up
   *  with the recording, lib/tabAlign.ts). Never awaited. */
  onAdded?: (rows: RecordModel[]) => void;
}

// ── the lookup record ─────────────────────────────────────────────────────

export async function findLookup(pb: PocketBase, key: string, site: string = UG_SITE): Promise<RecordModel | null> {
  const found = await pb
    .collection('tab_lookups')
    .getList(1, 1, { filter: pb.filter('song_key = {:k} && site = {:s}', { k: key, s: site }) });
  return found.items[0] ?? null;
}

async function saveLookup(
  pb: PocketBase,
  existing: RecordModel | null,
  data: { song_key: string; site: string; status: 'found' | 'none'; query: string; searched_at: string; results: unknown },
): Promise<void> {
  if (existing) await pb.collection('tab_lookups').update(existing.id, data);
  else await pb.collection('tab_lookups').create(data);
}

/** The candidates as the lookup row keeps them. */
function summary(r: UgResult) {
  return { id: r.id, part: r.part, section: r.section, version: r.version, rating: r.rating, votes: r.votes, url: r.url };
}

// ── the search ────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<OnlineResult>>();

/** For tests: forget searches in flight. */
export function resetOnline(): void {
  inflight.clear();
  shared = null;
}

/** Look for the song online unless it was looked for already (or `again`).
 *  Never throws. */
export function findOnline(
  pb: PocketBase,
  song: OnlineSong,
  opts: { again?: boolean } & OnlineDeps = {},
): Promise<OnlineResult> {
  const key = songKeyOf(song);
  const running = inflight.get(key);
  if (running) return running;
  const job = search(pb, song, key, opts).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** One site's search for the song. */
interface SiteResult {
  status: 'found' | 'none' | 'failed';
  searchedAt: string | null;
  added: RecordModel[];
}

interface SiteContext {
  pb: PocketBase;
  song: OnlineSong;
  key: string;
  lookup: RecordModel | null;
  fetcher: PoliteFetcher;
  now: () => Date;
  dir: string;
  writer: () => Promise<PocketBase>;
  opts: OnlineDeps;
}

async function search(pb: PocketBase, song: OnlineSong, key: string, opts: { again?: boolean } & OnlineDeps): Promise<OnlineResult> {
  const title = song.title.trim();
  if (!title) return { status: 'none', searchedAt: null, added: 0 };
  const sites = opts.sites ?? ONLINE_SITES;

  const lookups = new Map<OnlineSite, RecordModel | null>();
  try {
    for (const site of sites) lookups.set(site, await findLookup(pb, key, site));
  } catch (e) {
    serverLogger.error('tabs', 'online lookup read failed', { key }, e);
    return { status: 'failed', searchedAt: null, added: 0 };
  }
  const latest = () =>
    [...lookups.values()]
      .map((l) => String(l?.searched_at || ''))
      .filter(Boolean)
      .sort()
      .pop() ?? null;
  const todo = sites.filter((site) => opts.again || !lookups.get(site));
  if (todo.length === 0) return { status: 'cached', searchedAt: latest(), added: 0 };

  const ctx = (site: OnlineSite): SiteContext => ({
    pb,
    song,
    key,
    lookup: lookups.get(site) ?? null,
    fetcher: opts.fetcher ?? tabFetcher(),
    now: opts.now ?? (() => new Date()),
    dir: opts.dir ?? FETCHED_DIR,
    writer: async () => (opts.freshPb ? opts.freshPb() : pb),
    opts,
  });

  const results: SiteResult[] = [];
  for (const site of todo) {
    const r = site === SONGSTERR_SITE ? await searchSongsterr(ctx(site)) : await searchUg(ctx(site));
    results.push(r);
    if (r.added.length > 0 && opts.onAdded) {
      try {
        opts.onAdded(r.added);
      } catch (e) {
        serverLogger.error('tabs', 'after an online find', { key }, e);
      }
    }
  }
  const added = results.reduce((n, r) => n + r.added.length, 0);
  const searchedAt =
    results
      .map((r) => r.searchedAt)
      .filter((s): s is string => !!s)
      .sort()
      .pop() ?? latest();
  const status: OnlineStatus = results.some((r) => r.status === 'found')
    ? 'found'
    : results.some((r) => r.status === 'failed')
      ? 'failed'
      : 'none';
  return { status, searchedAt: status === 'failed' ? null : searchedAt, added };
}

/** Log a site's failure the way it deserves: a "slow down" is expected. */
function logFailure(siteLabel: string, query: string, e: unknown): void {
  if (e instanceof SiteBackoffError) {
    serverLogger.warn('tabs', `${siteLabel} asked us to slow down`, { query, status: e.status, until: new Date(e.until).toISOString() });
  } else {
    serverLogger.error('tabs', `${siteLabel} tab search failed`, { query }, e);
  }
}

// ── Ultimate Guitar ───────────────────────────────────────────────────────

async function searchUg(c: SiteContext): Promise<SiteResult> {
  const { song, key, lookup, fetcher, now } = c;
  const base = c.opts.base ?? ugBase();
  const query = ugQuery(song.title.trim(), song.artist);
  const added: RecordModel[] = [];
  try {
    const stored: RecordModel[] = await c.pb
      .collection('tabs')
      .getFullList({ filter: c.pb.filter('song_key = {:k} && kind = "fetched" && source_site = {:s}', { k: key, s: UG_SITE }) });

    const html = await fetcher.getText(UG_SITE, ugSearchUrl(base, query));
    const results = parseUgSearch(html);
    if (!results) {
      // A page without the data: a block or captcha page served as a 200.
      // Treat it like a "slow down" and remember nothing.
      fetcher.backOff(UG_SITE, null);
      serverLogger.error('tabs', 'ultimate guitar search page unreadable, backing off', { query });
      return { status: 'failed', searchedAt: null, added };
    }
    const picks = chooseUg(results, song);

    let turns = MAX_TAB_PAGES;
    for (const part of ['guitar', 'bass'] as UgPart[]) {
      for (const cand of picks[part]) {
        // Already in the store (a search again): nothing to fetch.
        if (stored.some((r) => String(r.source_id) === String(cand.id))) break;
        if (turns <= 0) break;
        turns -= 1;
        const row = await fetchUgTab(await c.writer(), fetcher, song, key, cand, c.dir, now);
        if (row) {
          stored.push(row);
          added.push(row);
          break;
        }
      }
    }

    const searchedAt = now().toISOString();
    await saveLookup(await c.writer(), lookup, {
      song_key: key,
      site: UG_SITE,
      status: stored.length > 0 ? 'found' : 'none',
      query,
      searched_at: searchedAt,
      results: [...picks.guitar, ...picks.bass].slice(0, KEEP_RESULTS).map(summary),
    });
    return { status: stored.length > 0 ? 'found' : 'none', searchedAt, added };
  } catch (e) {
    logFailure('ultimate guitar', query, e);
    // A tab stored before the failure still counts: the song was found.
    if (added.length > 0) return foundAfterFailure(c, UG_SITE, query, added);
    return { status: 'failed', searchedAt: null, added };
  }
}

async function foundAfterFailure(c: SiteContext, site: OnlineSite, query: string, added: RecordModel[]): Promise<SiteResult> {
  const searchedAt = c.now().toISOString();
  await saveLookup(await c.writer(), c.lookup, { song_key: c.key, site, status: 'found', query, searched_at: searchedAt, results: [] }).catch(
    (err) => serverLogger.error('tabs', 'saving the online lookup failed', { key: c.key }, err),
  );
  return { status: 'found', searchedAt, added };
}

/** Fetch one tab page, turn it into alphaTex, store the files and the row.
 *  Null when the page is not a text tab Ember can read (not an error: the
 *  next candidate may be). Fetch errors are thrown to the search. */
async function fetchUgTab(
  pb: PocketBase,
  fetcher: PoliteFetcher,
  song: OnlineSong,
  key: string,
  cand: UgResult,
  dir: string,
  now: () => Date,
): Promise<RecordModel | null> {
  let html: string;
  try {
    html = await fetcher.getText(UG_SITE, tabPageUrl(cand.url));
  } catch (e) {
    // A page gone missing is skipped; a "slow down" stops the search.
    if (e instanceof FetchStatusError && (e.status === 404 || e.status === 410)) {
      serverLogger.warn('tabs', 'ultimate guitar tab page gone', { id: cand.id, status: e.status });
      return null;
    }
    throw e;
  }
  const page = parseUgTabPage(html);
  if (!page || page.id !== cand.id) {
    serverLogger.warn('tabs', 'ultimate guitar tab page unreadable', { id: cand.id });
    return null;
  }
  const parsed = ugTabToAlphaTex(page, song);
  if (!parsed.ok) {
    serverLogger.warn('tabs', 'ultimate guitar tab has no notes Ember can read', { id: cand.id, error: parsed.error });
    return null;
  }

  return storeFetched(pb, dir, parsed.alphaTex, { ext: '.txt', text: page.text }, {
    title: song.title.slice(0, 200) || 'Untitled',
    artist: song.artist.slice(0, 200),
    instrument: page.part === 'bass' ? 'Bass' : 'Guitar',
    size_bytes: Buffer.byteLength(page.text),
    song_key: key,
    track_key: song.trackId.slice(0, 80),
    source_site: UG_SITE,
    source_url: page.url,
    source_id: String(page.id),
    source_rating: Math.round(page.rating * 100) / 100,
    source_votes: page.votes,
    source_meta: {
      part: page.part,
      section: page.section,
      version: page.version,
      songName: page.songName.slice(0, 200),
      artistName: page.artistName.slice(0, 200),
      tuning: page.tuning,
      capo: page.capo,
      report: {
        strings: parsed.report.strings,
        tuningName: parsed.report.tuningName,
        bars: parsed.report.bars,
        notes: parsed.report.notes,
        tempo: parsed.report.tempo,
        tempoSource: parsed.report.tempoSource,
      },
      fetchedAt: now().toISOString(),
    },
  });
}

/** Write the alphaTex and its source beside it, then the row; the files go
 *  again if the row cannot be written. */
async function storeFetched(
  pb: PocketBase,
  dir: string,
  alphaTex: string,
  source: { ext: '.txt' | '.json'; text: string },
  row: Record<string, unknown>,
): Promise<RecordModel> {
  await fs.mkdir(dir, { recursive: true });
  const filename = newTabFilename('.alphatex');
  const stem = filename.slice(0, -'.alphatex'.length);
  const texPath = path.join(dir, filename);
  const srcPath = path.join(dir, `${stem}${source.ext}`);
  await fs.writeFile(texPath, alphaTex, 'utf8');
  await fs.writeFile(srcPath, source.text, 'utf8');
  try {
    return await pb.collection('tabs').create({
      ...row,
      file: filename,
      kind: 'fetched',
      format: 'alphatex',
      shared: true,
      offset_ms: 0,
    });
  } catch (e) {
    await Promise.all([fs.unlink(texPath), fs.unlink(srcPath)].map((p) => p.catch(() => undefined)));
    throw e;
  }
}

// ── Songsterr ─────────────────────────────────────────────────────────────

/** The body of a JSON answer, or null when it is not JSON (a block page). */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function searchSongsterr(c: SiteContext): Promise<SiteResult> {
  const { song, key, lookup, fetcher, now } = c;
  const base = c.opts.songsterrBase ?? songsterrBase();
  const cdn = c.opts.songsterrCdn ?? songsterrCdnBase();
  const query = ugQuery(song.title.trim(), song.artist);
  const added: RecordModel[] = [];
  const done = async (status: 'found' | 'none', hits: SongsterrHit[]): Promise<SiteResult> => {
    const searchedAt = now().toISOString();
    await saveLookup(await c.writer(), lookup, {
      song_key: key,
      site: SONGSTERR_SITE,
      status,
      query,
      searched_at: searchedAt,
      results: hits.slice(0, KEEP_RESULTS),
    });
    return { status, searchedAt, added };
  };
  try {
    const stored: RecordModel[] = await c.pb
      .collection('tabs')
      .getFullList({ filter: c.pb.filter('song_key = {:k} && kind = "fetched" && source_site = {:s}', { k: key, s: SONGSTERR_SITE }) });

    const hits = parseSongsterrSearch(jsonOf(await fetcher.getText(SONGSTERR_SITE, `${base}/api/songs?pattern=${encodeURIComponent(query)}`)));
    if (!hits) {
      fetcher.backOff(SONGSTERR_SITE, null);
      serverLogger.error('tabs', 'songsterr search answer unreadable, backing off', { query });
      return { status: 'failed', searchedAt: null, added };
    }
    const picks = chooseSongsterrSongs(hits, song);
    const best = picks[0];
    if (!best) return await done('none', picks);
    if (stored.some((r) => String(r.source_id) === String(best.songId))) return await done('found', picks);

    let html: string;
    try {
      html = await fetcher.getText(SONGSTERR_SITE, songsterrPageUrl(base, best));
    } catch (e) {
      if (e instanceof FetchStatusError && (e.status === 404 || e.status === 410)) {
        serverLogger.warn('tabs', 'songsterr song page gone', { songId: best.songId, status: e.status });
        return await done(stored.length ? 'found' : 'none', picks);
      }
      throw e;
    }
    const page = parseSongsterrPage(html);
    if (!page || page.songId !== best.songId) {
      fetcher.backOff(SONGSTERR_SITE, null);
      serverLogger.error('tabs', 'songsterr song page unreadable, backing off', { songId: best.songId });
      return { status: 'failed', searchedAt: null, added };
    }
    if (page.restricted) {
      // Ember reads what any browser is given, never around a restriction.
      serverLogger.warn('tabs', 'songsterr tab is restricted, left alone', { songId: page.songId });
      return await done(stored.length ? 'found' : 'none', picks);
    }

    const tracks = chooseSongsterrTracks(page.tracks);
    const input: { track: SongsterrTrack; part: SongsterrPart }[] = [];
    const raw: unknown[] = [];
    for (const track of tracks) {
      let text: string;
      try {
        text = await fetcher.getText(SONGSTERR_CDN_SITE, partUrl(cdn, page, track.partId));
      } catch (e) {
        if (e instanceof FetchStatusError && (e.status === 404 || e.status === 410)) {
          serverLogger.warn('tabs', 'songsterr part missing', { songId: page.songId, partId: track.partId });
          continue;
        }
        throw e;
      }
      const json = jsonOf(text);
      const part = readSongsterrPart(json);
      if (!part) {
        serverLogger.warn('tabs', 'songsterr part unreadable', { songId: page.songId, partId: track.partId });
        continue;
      }
      input.push({ track, part });
      raw.push(json);
    }
    const converted = songsterrToAlphaTex(input, { title: page.title || song.title, artist: page.artist || song.artist });
    if (!converted.ok) {
      serverLogger.warn('tabs', 'songsterr tab has no notes Ember can read', { songId: page.songId, error: converted.error });
      return await done(stored.length ? 'found' : 'none', picks);
    }

    const source = JSON.stringify({ songId: page.songId, revisionId: page.revisionId, image: page.image, tracks: input.map((i) => i.track), parts: raw });
    const url = songsterrPageUrl('https://www.songsterr.com', { songId: page.songId, artist: page.artist, title: page.title });
    const row = await storeFetched(await c.writer(), c.dir, converted.alphaTex, { ext: '.json', text: source }, {
      title: song.title.slice(0, 200) || 'Untitled',
      artist: song.artist.slice(0, 200),
      instrument: 'Guitar',
      size_bytes: Buffer.byteLength(source),
      song_key: key,
      track_key: song.trackId.slice(0, 80),
      source_site: SONGSTERR_SITE,
      source_url: url,
      source_id: String(page.songId),
      source_meta: {
        part: 'multi',
        revisionId: page.revisionId,
        image: page.image,
        songName: page.title,
        artistName: page.artist,
        instruments: input.map((i) => trackLabel(i.track)),
        parts: input.map((i) => ({ partId: i.track.partId, name: i.track.name, instrument: i.track.instrument, tuning: i.track.tuning })),
        report: converted.report,
        fetchedAt: now().toISOString(),
      },
    });
    added.push(row);
    return await done('found', picks);
  } catch (e) {
    logFailure('songsterr', query, e);
    if (added.length > 0) return foundAfterFailure(c, SONGSTERR_SITE, query, added);
    return { status: 'failed', searchedAt: null, added };
  }
}
