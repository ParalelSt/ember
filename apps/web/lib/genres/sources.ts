import { normalizeArtist } from '../songKey';
import type { RawTag } from './taxonomy';

/** The two artist tag sources (docs/mixes.md): Last.fm `artist.getTopTags`
 *  when LASTFM_API_KEY is set, MusicBrainz otherwise (and as Last.fm's
 *  fallback for an artist it does not know). Pure HTTP, fetch injected so
 *  tests run on saved responses. Both answer null for "this artist is not
 *  there" and throw for a fault (network, rate limit, 5xx): a fault is
 *  retried later, never written down as "no genre". */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TOP_TAGS = 15;

export interface LastfmTopTags {
  toptags?: { tag?: { name?: string; count?: number | string }[] | { name?: string; count?: number | string } };
  error?: number;
  message?: string;
}

/** Last.fm's top tags of an artist, strongest first (count 0..100). */
export async function lastfmTopTags(name: string, apiKey: string, fetchImpl: Fetch = fetch): Promise<RawTag[] | null> {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1&format=json&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as LastfmTopTags | null;
  // Error 6: "The artist you supplied could not be found".
  if (body?.error === 6) return null;
  if (!res.ok || !body || body.error) throw new Error(`last.fm: ${body?.message ?? `HTTP ${res.status}`}`);
  const raw = body.toptags?.tag;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((t) => t && typeof t.name === 'string' && t.name.trim())
    .slice(0, TOP_TAGS)
    .map((t) => ({ name: String(t.name).trim(), count: Number(t.count) || 0 }));
}

export interface MbArtistSearch {
  artists?: { id?: string; name?: string; score?: number | string; aliases?: { name?: string }[]; tags?: { name?: string; count?: number }[] }[];
}

export interface MbArtist {
  id?: string;
  name?: string;
  genres?: { name?: string; count?: number }[];
  tags?: { name?: string; count?: number }[];
}

/** MusicBrainz asks for a User-Agent naming the app and a contact. */
export function musicbrainzUserAgent(contact: string | undefined): string {
  const c = String(contact ?? '').trim();
  return `Ember/1.0 ( ${c || 'self-hosted Ember music server'} )`;
}

/** The best search hit for a name: the same name once normalized (or one
 *  of its aliases), with a search score of at least 85. MusicBrainz knows
 *  many artists of the same name; the highest score wins. */
export function pickMbArtist(search: MbArtistSearch | null | undefined, name: string): string | null {
  const want = normalizeArtist(name) || name.trim().toLowerCase();
  const hits = (search?.artists ?? [])
    .filter((a) => a?.id && Number(a.score ?? 0) >= 85)
    .filter((a) => {
      const names = [a.name, ...(a.aliases ?? []).map((x) => x?.name)].filter((x): x is string => typeof x === 'string');
      return names.some((n) => (normalizeArtist(n) || n.trim().toLowerCase()) === want);
    })
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  return hits[0]?.id ?? null;
}

/** Genres (curated, counted double) and tags of an artist looked up by
 *  name: a search, then the artist with inc=genres+tags. `pace` is awaited
 *  before each of the two requests (MusicBrainz allows one a second). */
export async function musicbrainzTags(
  name: string,
  { userAgent, pace = async () => {}, fetchImpl = fetch }: { userAgent: string; pace?: () => Promise<void>; fetchImpl?: Fetch },
): Promise<RawTag[] | null> {
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  const q = `artist:"${name.replace(/(["\\])/g, '\\$1')}"`;
  await pace();
  const res = await fetchImpl(`https://musicbrainz.org/ws/2/artist/?fmt=json&limit=5&query=${encodeURIComponent(q)}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`musicbrainz: search HTTP ${res.status}`);
  const id = pickMbArtist((await res.json()) as MbArtistSearch, name);
  if (!id) return null;
  await pace();
  const one = await fetchImpl(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(id)}?fmt=json&inc=genres+tags`, { headers, signal: AbortSignal.timeout(15_000) });
  if (one.status === 404) return null;
  if (!one.ok) throw new Error(`musicbrainz: artist HTTP ${one.status}`);
  const artist = (await one.json()) as MbArtist;
  const tags: RawTag[] = [];
  for (const g of artist.genres ?? []) if (g?.name) tags.push({ name: g.name, count: (Number(g.count) || 1) * 2 });
  for (const t of artist.tags ?? []) if (t?.name) tags.push({ name: t.name, count: Number(t.count) || 1 });
  tags.sort((a, b) => b.count - a.count);
  return tags.slice(0, TOP_TAGS * 2);
}
