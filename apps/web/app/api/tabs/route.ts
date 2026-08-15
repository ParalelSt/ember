import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { keyFromRequest, rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';

/** Guitar tabs for the playing track, via Songsterr's public search endpoint.
 *
 *  Proxied server-side for three reasons: the browser would be blocked by CORS,
 *  it lets us cache (Songsterr is a third party doing us a favour), and it
 *  keeps our rate limiting in one place.
 *
 *  Note we can only LINK to tabs, never embed them: Songsterr serves
 *  `X-Frame-Options: deny`, so an in-app tab viewer is impossible by their
 *  choice, not ours. */

interface SongsterrTrack {
  instrument?: string;
}
interface SongsterrSong {
  songId?: number;
  artist?: string;
  title?: string;
  hasChords?: boolean;
  tracks?: SongsterrTrack[];
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

const CACHE = new Map<string, { matches: TabMatch[]; expires: number }>();
const TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;

/** Songsterr fuzzy-matches on any single word, so "zzzz nobody" happily returns
 *  Avenged Sevenfold's "Nobody". Keep only results that share a real word with
 *  the track's TITLE — variants ("… (Remastered)", live versions) still pass,
 *  pure noise doesn't. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function relevant(match: { title: string; artist: string }, title: string, artist: string): boolean {
  const want = new Set(words(title));
  if (want.size === 0) return true;                       // nothing to compare against
  const got = new Set(words(match.title));
  const titleOverlap = [...want].filter((w) => got.has(w)).length;
  // Either a decent chunk of the title matches, or the artist matches and at
  // least one title word does.
  const artistMatch = words(artist).some((w) => words(match.artist).includes(w));
  return titleOverlap >= Math.min(2, want.size) || (artistMatch && titleOverlap >= 1);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'song';
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const limited = rateLimitResponse(`tabs:${keyFromRequest(request)}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;

    const title = (request.nextUrl.searchParams.get('title') ?? '').trim();
    const artist = (request.nextUrl.searchParams.get('artist') ?? '').trim();
    if (!title) return jsonError('title required', 400);

    // Artist first: Songsterr's matching leans on the leading words.
    const pattern = `${artist} ${title}`.trim().slice(0, 200);
    const key = pattern.toLowerCase();

    const hit = CACHE.get(key);
    if (hit && hit.expires > Date.now()) return Response.json({ matches: hit.matches });

    const res = await fetch(
      `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(pattern)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ember/1.0)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      serverLogger.error('tabs', `songsterr ${res.status}`, { pattern });
      return Response.json({ matches: [] });
    }

    const raw = (await res.json()) as SongsterrSong[];
    const matches: TabMatch[] = (Array.isArray(raw) ? raw : [])
      .filter((s) => typeof s.songId === 'number' && s.title)
      .filter((s) => relevant({ title: s.title ?? '', artist: s.artist ?? '' }, title, artist))
      .slice(0, 8)
      .map((s) => {
        const a = s.artist ?? '';
        const t = s.title ?? '';
        return {
          id: s.songId as number,
          artist: a,
          title: t,
          hasChords: s.hasChords === true,
          instruments: Array.from(
            new Set((s.tracks ?? []).map((tr) => tr.instrument).filter((x): x is string => !!x)),
          ).slice(0, 4),
          // Songsterr resolves purely on the trailing -s<id>; the slug is
          // cosmetic (verified: a bogus slug with the right id still loads).
          url: `https://www.songsterr.com/a/wsa/${slug(a)}-${slug(t)}-tab-s${s.songId}`,
        };
      });

    if (CACHE.size >= CACHE_MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest !== undefined) CACHE.delete(oldest);
    }
    CACHE.set(key, { matches, expires: Date.now() + TTL_MS });

    return Response.json({ matches });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    // A third party being down must never break the player.
    serverLogger.error('tabs', 'lookup failed', undefined, e);
    return Response.json({ matches: [] });
  }
}
