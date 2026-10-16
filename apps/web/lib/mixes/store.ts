import type PocketBase from 'pocketbase';
import type { Track } from '../../types/track';
import { pbQuote } from '../genres/store';
import type { MixRow, StoredMix } from './job';

/** The `mixes` collection (pocketbase/pb_hooks/ensure_mixes.pb.js). */

export interface MixRecord {
  id: string;
  user: string;
  key: string;
  title?: string;
  subtitle?: string;
  position?: number;
  tracks?: Track[] | null;
  seeds?: string[] | null;
  cover?: { artworkUrls?: string[]; color?: string } | null;
  built_at?: string;
}

export interface MixView {
  key: string;
  title: string;
  subtitle: string;
  position: number;
  cover: { artworkUrls: string[]; color: string };
  builtAt: string;
  tracks: Track[];
  seeds: string[];
}

export function fromMixRecord(r: MixRecord): MixView {
  return {
    key: r.key,
    title: r.title ?? r.key,
    subtitle: r.subtitle ?? '',
    position: Number(r.position) || 0,
    cover: {
      artworkUrls: Array.isArray(r.cover?.artworkUrls) ? r.cover!.artworkUrls!.filter((u) => typeof u === 'string').slice(0, 3) : [],
      color: typeof r.cover?.color === 'string' ? r.cover.color : '',
    },
    builtAt: r.built_at ?? '',
    tracks: Array.isArray(r.tracks) ? r.tracks.filter((t) => t && typeof t.id === 'string') : [],
    seeds: Array.isArray(r.seeds) ? r.seeds : [],
  };
}

/** Admin-client reads and writes for the nightly build. */
export function pbMixStore(client: () => Promise<PocketBase>) {
  return {
    async listMixes(userId: string): Promise<StoredMix[]> {
      const pb = await client();
      const rows = await pb.collection('mixes').getFullList<MixRecord>({ filter: `user = ${pbQuote(userId)}`, fields: 'id,key,built_at' });
      return rows.map((r) => ({ id: r.id, key: r.key, builtAt: r.built_at ?? '' }));
    },
    async saveMix(userId: string, row: MixRow): Promise<void> {
      const pb = await client();
      const data = {
        user: userId, key: row.key, title: row.title, subtitle: row.subtitle.slice(0, 300), position: row.position,
        tracks: row.tracks, seeds: row.seeds, cover: row.cover, built_at: row.builtAt,
      };
      const found = await pb.collection('mixes')
        .getFirstListItem<MixRecord>(`user = ${pbQuote(userId)} && key = ${pbQuote(row.key)}`)
        .catch((e: { status?: number }) => {
          if (e?.status === 404) return null;
          throw e;
        });
      if (found) await pb.collection('mixes').update(found.id, data);
      else await pb.collection('mixes').create(data);
    },
    async deleteMix(id: string): Promise<void> {
      const pb = await client();
      await pb.collection('mixes').delete(id);
    },
  };
}
