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
import { DEFAULT_GAP_MS, FetchStatusError, PoliteFetcher, SiteBackoffError } from '@/lib/tabFetch/polite';

/** Ember looks for a song's tab online (docs/tabs-v3.md, stage 3: Ultimate
 *  Guitar text tabs), once per song, and keeps what it found in the shared
 *  store:
 *
 *   - a `tabs` row per tab (kind "fetched", shared, alphaTex, source_* with
 *     the page, UG's id, rating and votes), files in MUSIC_DIR/tabs/fetched;
 *   - a `tab_lookups` row per song and site: "found" or "none". With one,
 *     the song is never searched again on its own; "Search online again"
 *     (`again`) is the only way.
 *
 *  Polite: one search and at most MAX_TAB_PAGES tab pages per song, through
 *  one queue per site for the whole server (lib/tabFetch/polite.ts: 2 s
 *  between requests, an hour's pause on 429/403/503). Two people opening
 *  the same song share one search.
 *
 *  Quiet: a failure is logged and the song is left unrecorded, so the page
 *  simply shows its other sources and the next opening tries again (after
 *  any pause). Nothing here throws to the caller. */

export const UG_SITE = 'ug';

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
  /** When the song was searched (the lookup row), if it has been. */
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
  base?: string;
  now?: () => Date;
  /** Where the files go (tests use a temp dir). */
  dir?: string;
  /** A freshly signed-in admin client for each write. The search can wait
   *  in the site's queue for a long time and is shared by every request
   *  for the song, so it does not lean on the client of the request that
   *  started it (the sandbox saw that client go signed-out mid-search).
   *  Tests leave it out and write through `pb`. */
  freshPb?: () => Promise<PocketBase>;
}

// ── the lookup record ─────────────────────────────────────────────────────

export async function findLookup(pb: PocketBase, key: string, site = UG_SITE): Promise<RecordModel | null> {
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

async function search(pb: PocketBase, song: OnlineSong, key: string, opts: { again?: boolean } & OnlineDeps): Promise<OnlineResult> {
  const fetcher = opts.fetcher ?? tabFetcher();
  const base = opts.base ?? ugBase();
  const now = opts.now ?? (() => new Date());
  const writer = async () => (opts.freshPb ? opts.freshPb() : pb);
  const title = song.title.trim();
  if (!title) return { status: 'none', searchedAt: null, added: 0 };

  let lookup: RecordModel | null;
  try {
    lookup = await findLookup(pb, key);
  } catch (e) {
    serverLogger.error('tabs', 'online lookup read failed', { key }, e);
    return { status: 'failed', searchedAt: null, added: 0 };
  }
  if (lookup && !opts.again) return { status: 'cached', searchedAt: String(lookup.searched_at || '') || null, added: 0 };

  const query = ugQuery(title, song.artist);
  let added = 0;
  let stored: RecordModel[] = [];
  try {
    stored = await pb
      .collection('tabs')
      .getFullList({ filter: pb.filter('song_key = {:k} && kind = "fetched" && source_site = {:s}', { k: key, s: UG_SITE }) });

    const html = await fetcher.getText(UG_SITE, ugSearchUrl(base, query));
    const results = parseUgSearch(html);
    if (!results) {
      // A page without the data: a block or captcha page served as a 200.
      // Treat it like a "slow down" and remember nothing.
      fetcher.backOff(UG_SITE, null);
      serverLogger.error('tabs', 'ultimate guitar search page unreadable, backing off', { query });
      return { status: 'failed', searchedAt: null, added: 0 };
    }
    const picks = chooseUg(results, song);

    let turns = MAX_TAB_PAGES;
    for (const part of ['guitar', 'bass'] as UgPart[]) {
      for (const cand of picks[part]) {
        // Already in the store (a search again): nothing to fetch.
        if (stored.some((r) => String(r.source_id) === String(cand.id))) break;
        if (turns <= 0) break;
        turns -= 1;
        const row = await fetchOne(await writer(), fetcher, song, key, cand, opts.dir ?? FETCHED_DIR, now);
        if (row) {
          stored.push(row);
          added += 1;
          break;
        }
      }
    }

    const searchedAt = now().toISOString();
    await saveLookup(await writer(), lookup, {
      song_key: key,
      site: UG_SITE,
      status: stored.length > 0 ? 'found' : 'none',
      query,
      searched_at: searchedAt,
      results: [...picks.guitar, ...picks.bass].slice(0, KEEP_RESULTS).map(summary),
    });
    return { status: stored.length > 0 ? 'found' : 'none', searchedAt, added };
  } catch (e) {
    if (e instanceof SiteBackoffError) {
      serverLogger.warn('tabs', 'ultimate guitar asked us to slow down', { query, status: e.status, until: new Date(e.until).toISOString() });
    } else {
      serverLogger.error('tabs', 'online tab search failed', { query }, e);
    }
    // A tab stored before the failure still counts: the song was found.
    if (added > 0) {
      const searchedAt = now().toISOString();
      await saveLookup(await writer(), lookup, { song_key: key, site: UG_SITE, status: 'found', query, searched_at: searchedAt, results: [] }).catch(
        (err) => serverLogger.error('tabs', 'saving the online lookup failed', { key }, err),
      );
      return { status: 'found', searchedAt, added };
    }
    return { status: 'failed', searchedAt: null, added: 0 };
  }
}

/** Fetch one tab page, turn it into alphaTex, store the files and the row.
 *  Null when the page is not a text tab Ember can read (not an error: the
 *  next candidate may be). Fetch errors are thrown to the search. */
async function fetchOne(
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

  await fs.mkdir(dir, { recursive: true });
  const filename = newTabFilename('.alphatex');
  const stem = filename.slice(0, -'.alphatex'.length);
  const texPath = path.join(dir, filename);
  const txtPath = path.join(dir, `${stem}.txt`);
  await fs.writeFile(texPath, parsed.alphaTex, 'utf8');
  await fs.writeFile(txtPath, page.text, 'utf8');
  try {
    return await pb.collection('tabs').create({
      title: song.title.slice(0, 200) || 'Untitled',
      artist: song.artist.slice(0, 200),
      instrument: page.part === 'bass' ? 'Bass' : 'Guitar',
      file: filename,
      size_bytes: Buffer.byteLength(page.text),
      kind: 'fetched',
      format: 'alphatex',
      shared: true,
      song_key: key,
      track_key: song.trackId.slice(0, 80),
      offset_ms: 0,
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
  } catch (e) {
    await Promise.all([fs.unlink(texPath), fs.unlink(txtPath)].map((p) => p.catch(() => undefined)));
    throw e;
  }
}
