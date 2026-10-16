import type PocketBase from 'pocketbase';
import { isFamilySlug, type FamilySlug, type RawTag, type SubSlug } from './taxonomy';
import type { ArtistGenre, GenreSource, GenreStore } from './tagger';

/** artist_genres in PocketBase (pocketbase/pb_hooks/ensure_artist_genres.pb.js),
 *  read and written with an admin client. */

export interface ArtistGenreRecord {
  id?: string;
  artist_key: string;
  artist_id?: string;
  name?: string;
  family?: string;
  families?: Record<string, number> | null;
  sub?: string;
  tags?: RawTag[] | null;
  source: GenreSource;
  status: 'found' | 'none';
  fetched_at?: string;
}

const SUBS = new Set(['rock', 'metal', 'hiphop', 'rnb']);

export function fromRecord(r: ArtistGenreRecord): ArtistGenre {
  const families: Partial<Record<FamilySlug, number>> = {};
  for (const [k, v] of Object.entries(r.families ?? {})) if (isFamilySlug(k) && Number.isFinite(v)) families[k] = v;
  return {
    key: r.artist_key,
    name: r.name ?? r.artist_key,
    artistId: r.artist_id || null,
    family: isFamilySlug(r.family) ? r.family : null,
    families,
    sub: r.sub && SUBS.has(r.sub) ? (r.sub as SubSlug) : null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    source: r.source,
    status: r.status === 'none' ? 'none' : 'found',
    fetchedAt: r.fetched_at ?? '',
  };
}

export function toRecord(g: ArtistGenre): ArtistGenreRecord {
  return {
    artist_key: g.key,
    artist_id: g.artistId ?? '',
    name: g.name.slice(0, 200),
    family: g.family ?? '',
    families: g.families,
    sub: g.sub ?? '',
    tags: g.tags.slice(0, 40),
    source: g.source,
    status: g.status,
    fetched_at: g.fetchedAt,
  };
}

/** A PocketBase filter string literal. */
export function pbQuote(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const CHUNK = 30;

export function pbGenreStore(client: () => Promise<PocketBase>): GenreStore {
  return {
    async getMany(keys) {
      const out = new Map<string, ArtistGenre>();
      const unique = [...new Set(keys)].filter(Boolean);
      for (let i = 0; i < unique.length; i += CHUNK) {
        const part = unique.slice(i, i + CHUNK);
        const pb = await client();
        const rows = await pb.collection('artist_genres').getFullList<ArtistGenreRecord>({
          filter: part.map((k) => `artist_key = ${pbQuote(k)}`).join(' || '),
        });
        for (const r of rows) out.set(r.artist_key, fromRecord(r));
      }
      return out;
    },
    async save(row) {
      const pb = await client();
      const data = toRecord(row);
      const found = await pb.collection('artist_genres')
        .getFirstListItem<ArtistGenreRecord>(`artist_key = ${pbQuote(row.key)}`)
        .catch((e: { status?: number }) => {
          if (e?.status === 404) return null;
          throw e;
        });
      if (found?.id) await pb.collection('artist_genres').update(found.id, data);
      else await pb.collection('artist_genres').create(data);
    },
  };
}
