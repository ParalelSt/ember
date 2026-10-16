import 'server-only';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { createRateLimiter } from './rateLimit';
import { lastfmTopTags, musicbrainzTags, musicbrainzUserAgent } from './sources';
import { pbGenreStore } from './store';
import { createTagger, type Tagger } from './tagger';

/** The server's one tagger: Last.fm when LASTFM_API_KEY is set (4 a
 *  second), MusicBrainz always as the keyless path (1 a second, with
 *  MUSICBRAINZ_CONTACT in its User-Agent). GENRES_LOOKUP_DISABLED=1 keeps
 *  every lookup off (sandboxes, tests): only stored rows and chart priors
 *  count then. */
const SHARED = Symbol.for('ember.genreTagger');
type G = typeof globalThis & { [SHARED]?: Tagger };

export function genreTagger(): Tagger {
  const g = globalThis as G;
  if (g[SHARED]) return g[SHARED];
  const off = process.env.GENRES_LOOKUP_DISABLED === '1';
  const key = process.env.LASTFM_API_KEY?.trim();
  const lastfmPace = createRateLimiter(4);
  const mbPace = createRateLimiter(1);
  const userAgent = musicbrainzUserAgent(process.env.MUSICBRAINZ_CONTACT);
  g[SHARED] = createTagger({
    store: pbGenreStore(() => createCatalogClient()),
    lastfm: !off && key ? async (name) => { await lastfmPace.take(); return lastfmTopTags(name, key); } : null,
    musicbrainz: off ? null : (name) => musicbrainzTags(name, { userAgent, pace: mbPace.take }),
    warn: (message, detail) => serverLogger.warn('genres', message, detail),
  });
  return g[SHARED];
}
