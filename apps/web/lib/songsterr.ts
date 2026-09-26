import 'server-only';
import { serverLogger } from '@/lib/logger/server';

/** Songsterr's public search, metadata only.
 *
 *  Songsterr tells us which song a tab is for, which instruments it has and
 *  how they are tuned. Never the notes: those are its licensed content, and
 *  its player refuses to be embedded. So this is used two ways: the link-out
 *  list of the tab page's empty state, and hints (tuning, instruments)
 *  stored on the song's tab rows.
 *
 *  SONGSTERR_BASE points the sandbox at tests/fake-songsterr.mjs, so no test
 *  needs the internet. */

export interface SongsterrTrackHint {
  instrument: string;
  /** MIDI note per string, highest string first, as Songsterr lists it. */
  tuning: number[];
  difficulty: number | null;
}

export interface SongsterrSongHint {
  songId: number;
  artist: string;
  title: string;
  hasChords: boolean;
  tracks: SongsterrTrackHint[];
}

/** What a tab row stores in `hints`. */
export interface TabHints {
  source: 'songsterr';
  fetchedAt: string;
  songs: SongsterrSongHint[];
}

export interface TabMatch {
  id: number;
  artist: string;
  title: string;
  hasChords: boolean;
  /** Distinct instruments with a tab, e.g. ["Guitar", "Bass"]. */
  instruments: string[];
  url: string;
}

function base(): string {
  return (process.env.SONGSTERR_BASE ?? 'https://www.songsterr.com').replace(/\/+$/, '');
}

/** Songsterr fuzzy-matches on any single word, so "zzzz nobody" happily returns
 *  Avenged Sevenfold's "Nobody". Keep only results that share a real word with
 *  the track's TITLE: variants ("... (Remastered)", live versions) still pass,
 *  pure noise does not. */
function words(s: string): string[] {
  // Letters of any script: a Japanese or Cyrillic title has words too
  // (lib/tabFetch/ug.ts words has the story).
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 || (w.length > 0 && /[^\x00-\x7f]/.test(w)));
}

export function relevant(match: { title: string; artist: string }, title: string, artist: string): boolean {
  const want = new Set(words(title));
  if (want.size === 0) return true; // nothing to compare against
  const got = new Set(words(match.title));
  const titleOverlap = [...want].filter((w) => got.has(w)).length;
  // Either a decent chunk of the title matches, or the artist matches and at
  // least one title word does.
  const artistMatch = words(artist).some((w) => words(match.artist).includes(w));
  return titleOverlap >= Math.min(2, want.size) || (artistMatch && titleOverlap >= 1);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'song'
  );
}

/** Raw Songsterr JSON to hints: only well-formed songs relevant to the
 *  track, at most eight, each track's tuning kept as plain numbers. */
export function parseSongs(raw: unknown, title: string, artist: string): SongsterrSongHint[] {
  if (!Array.isArray(raw)) return [];
  const out: SongsterrSongHint[] = [];
  for (const s of raw as Record<string, unknown>[]) {
    if (!s || typeof s.songId !== 'number' || typeof s.title !== 'string' || !s.title) continue;
    const song = {
      songId: s.songId,
      artist: typeof s.artist === 'string' ? s.artist : '',
      title: s.title,
      hasChords: s.hasChords === true,
      tracks: (Array.isArray(s.tracks) ? (s.tracks as Record<string, unknown>[]) : [])
        .filter((t) => t && typeof t.instrument === 'string' && t.instrument)
        .slice(0, 12)
        .map((t) => ({
          instrument: String(t.instrument).slice(0, 60),
          tuning: Array.isArray(t.tuning) ? t.tuning.filter((n): n is number => Number.isInteger(n)).slice(0, 12) : [],
          difficulty: typeof t.difficulty === 'number' ? t.difficulty : null,
        })),
    };
    if (!relevant(song, title, artist)) continue;
    out.push(song);
    if (out.length >= 8) break;
  }
  return out;
}

export function toMatches(songs: SongsterrSongHint[]): TabMatch[] {
  return songs.map((s) => ({
    id: s.songId,
    artist: s.artist,
    title: s.title,
    hasChords: s.hasChords,
    instruments: Array.from(new Set(s.tracks.map((t) => t.instrument))).slice(0, 4),
    // Songsterr resolves purely on the trailing -s<id>; the slug is cosmetic
    // (verified: a bogus slug with the right id still loads).
    url: `https://www.songsterr.com/a/wsa/${slug(s.artist)}-${slug(s.title)}-tab-s${s.songId}`,
  }));
}

export function toHints(songs: SongsterrSongHint[], now = new Date()): TabHints {
  return { source: 'songsterr', fetchedAt: now.toISOString(), songs };
}

/** Hints read back from a row: anything malformed reads as none, so a bad
 *  row costs one more search rather than an error. */
export function readHints(value: unknown): TabHints | null {
  if (!value || typeof value !== 'object') return null;
  const h = value as Partial<TabHints>;
  if (h.source !== 'songsterr' || !Array.isArray(h.songs)) return null;
  return { source: 'songsterr', fetchedAt: String(h.fetchedAt ?? ''), songs: h.songs };
}

const CACHE = new Map<string, { songs: SongsterrSongHint[]; expires: number }>();
const TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;

/** For tests: forget everything cached in memory. */
export function clearSongsterrCache(): void {
  CACHE.clear();
}

/** Search Songsterr for a track, cached in memory for an hour. Returns null
 *  when Songsterr could not be asked (down, slow, bad status), which the
 *  caller must not store as "no tabs". */
export async function searchSongsterr(title: string, artist: string): Promise<SongsterrSongHint[] | null> {
  // Artist first: Songsterr's matching leans on the leading words.
  const pattern = `${artist} ${title}`.trim().slice(0, 200);
  const key = pattern.toLowerCase();

  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.songs;

  try {
    const res = await fetch(`${base()}/api/songs?pattern=${encodeURIComponent(pattern)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ember/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      serverLogger.error('tabs', `songsterr ${res.status}`, { pattern });
      return null;
    }
    const songs = parseSongs(await res.json(), title, artist);
    if (CACHE.size >= CACHE_MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest !== undefined) CACHE.delete(oldest);
    }
    CACHE.set(key, { songs, expires: Date.now() + TTL_MS });
    return songs;
  } catch (e) {
    serverLogger.error('tabs', 'songsterr lookup failed', { pattern }, e);
    return null;
  }
}
