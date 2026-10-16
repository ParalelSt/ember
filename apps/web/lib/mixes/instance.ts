import 'server-only';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fetchRadioBatch } from '@/lib/sources/youtube';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { chartsCache } from '@/lib/charts';
import { genreTagger } from '@/lib/genres/instance';
import { pbQuote } from '@/lib/genres/store';
import type { Track } from '@/types/track';
import { createMixJob, type MixJob } from './job';
import { pbMixStore } from './store';
import type { PlayEvent } from './score';

/** The server's one mix job (one runner per process, surviving hot
 *  reloads), wired to PocketBase, the player and the tagger. */
const SHARED = Symbol.for('ember.mixJob');
type G = typeof globalThis & { [SHARED]?: MixJob };

const pbTime = (iso: string) => iso.replace('T', ' ');

export function mixJob(): MixJob {
  const g = globalThis as G;
  if (g[SHARED]) return g[SHARED];
  const client = () => createCatalogClient();
  const store = pbMixStore(client);
  g[SHARED] = createMixJob({
    async listActiveMembers(sinceIso) {
      const pb = await client();
      const users = await pb.collection('users').getFullList<{ id: string }>({ fields: 'id' });
      const out: string[] = [];
      for (const u of users) {
        const some = await pb.collection('plays').getList(1, 1, {
          filter: `user = ${pbQuote(u.id)} && played_at >= ${pbQuote(pbTime(sinceIso))}`,
          fields: 'id',
          skipTotal: true,
        });
        if (some.items.length) out.push(u.id);
      }
      return out;
    },
    async loadPlays(userId, sinceIso) {
      const pb = await client();
      const rows = await pb.collection('plays').getFullList<{ played_at: string; expand?: { track?: TrackRecord } }>({
        filter: `user = ${pbQuote(userId)} && played_at >= ${pbQuote(pbTime(sinceIso))}`,
        sort: '-played_at',
        expand: 'track',
        batch: 500,
      });
      const out: PlayEvent[] = [];
      for (const r of rows) {
        const track = mapTrackRow(r.expand?.track ?? null);
        if (track) out.push({ track, playedAt: r.played_at });
      }
      return out;
    },
    async loadLikes(userId) {
      const pb = await client();
      const rows = await pb.collection('likes').getFullList<{ expand?: { track?: TrackRecord } }>({
        filter: `user = ${pbQuote(userId)}`,
        expand: 'track',
        batch: 500,
      });
      return rows.map((r) => mapTrackRow(r.expand?.track ?? null)).filter((t): t is Track => !!t);
    },
    ensureTags: (refs, opts) => genreTagger().ensureTagsCounted(refs, opts),
    radioBatch: (seeds, limit) => fetchRadioBatch(seeds, limit),
    genreCharts: async () => (await chartsCache().getAll()).charts.map((c) => ({ slug: c.slug, tracks: c.tracks })),
    unavailableIds: () => listUnavailableIds(),
    listMixes: (userId) => store.listMixes(userId),
    saveMix: (userId, row) => store.saveMix(userId, row),
    deleteMix: (id) => store.deleteMix(id),
    log: (message, detail) => serverLogger.info('mixes', message, detail),
    warn: (message, detail) => serverLogger.warn('mixes', message, detail),
  });
  return g[SHARED];
}
