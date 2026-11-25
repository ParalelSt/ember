import 'server-only';
import path from 'node:path';
import { chartsCache } from '@/lib/charts';
import { genreTagger } from '@/lib/genres/instance';
import { pbQuote } from '@/lib/genres/store';
import { serverLogger } from '@/lib/logger/server';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { fetchNewReleases, MUSIC_DIR } from '@/lib/sources/youtube';
import { createNewReleasesCache, type MemberLikes, type NewReleasesCache } from './cache';
import type { LikeRow } from './rules';

/** The server's one "New releases" cache (one per process, surviving hot
 *  reloads), wired to PocketBase, the player, the charts and the tagger.
 *  NEW_RELEASES_DISABLED=1 keeps the run off (sandboxes, tests). */
const SHARED = Symbol.for('ember.newReleases');
type G = typeof globalThis & { [SHARED]?: NewReleasesCache };

/** A like row with only what the rules read: when it was liked and the
 *  track's source and artist credit. */
interface LikeRecord {
  liked_at?: string;
  created?: string;
  expand?: { track?: { source?: string; artist?: string; artist_id?: string } };
}

function toLikeRow(r: LikeRecord): LikeRow {
  const t = r.expand?.track;
  return {
    source: t?.source ?? '',
    artistId: t?.artist_id || null,
    artist: t?.artist ?? '',
    likedAt: r.liked_at || null,
    created: r.created ?? '',
  };
}

export function newReleasesCache(): NewReleasesCache {
  const g = globalThis as G;
  if (g[SHARED]) return g[SHARED];
  const client = () => createCatalogClient();
  g[SHARED] = createNewReleasesCache({
    fetchReleases: (artistIds, opts) => fetchNewReleases(artistIds, opts),
    async loadMemberLikes() {
      const pb = await client();
      const users = await pb.collection('users').getFullList<{ id: string }>({ fields: 'id' });
      const out: MemberLikes[] = [];
      for (const u of users) {
        const rows = await pb.collection('likes').getFullList<LikeRecord>({
          filter: `user = ${pbQuote(u.id)}`,
          expand: 'track',
          fields: 'liked_at,created,expand.track.source,expand.track.artist,expand.track.artist_id',
          batch: 500,
        });
        // Recent plays count as likes for what is scanned (docs/new-releases.md).
        const plays = await pb.collection('plays').getFullList<{ played_at?: string; expand?: LikeRecord['expand'] }>({
          filter: `user = ${pbQuote(u.id)} && played_at >= "${new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ')}"`,
          expand: 'track',
          fields: 'played_at,expand.track.source,expand.track.artist,expand.track.artist_id',
          batch: 500,
        });
        const playRows = plays.map((p) => toLikeRow({ liked_at: p.played_at, created: p.played_at, expand: p.expand }));
        out.push({ id: u.id, likes: [...rows.map(toLikeRow), ...playRows] });
      }
      return out;
    },
    genreCharts: async () => (await chartsCache().getAll()).charts.map((c) => ({ slug: c.slug, tracks: c.tracks })),
    chartsBusy: () => chartsCache().busy(),
    familiesOf: (refs, opts) => genreTagger().ensureTags(refs, opts),
    cacheFile: path.join(MUSIC_DIR, 'new-releases.json'),
    warn: (message, detail) => serverLogger.warn('new-releases', message, detail),
    disabled: process.env.NEW_RELEASES_DISABLED === '1',
  });
  return g[SHARED];
}
