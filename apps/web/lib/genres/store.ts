import type PocketBase from 'pocketbase';
import { classifyTags, isFamilySlug, isSubSlug, type FamilySlug, type RawTag } from './taxonomy';
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

/** A stored row as the code reads it. A looked-up row (Last.fm,
 *  MusicBrainz) with tags is classified again from those tags, so a change
 *  to the taxonomy (a new family, a moved tag) applies to every artist
 *  already looked up, with no migration and no new lookups; the stored
 *  family column only catches up at the row's next refresh. A chart prior
 *  or an admin's row is read as stored. */
export function fromRecord(r: ArtistGenreRecord): ArtistGenre {
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const base = {
    key: r.artist_key,
    name: r.name ?? r.artist_key,
    artistId: r.artist_id || null,
    tags,
    source: r.source,
    fetchedAt: r.fetched_at ?? '',
  };
  if ((r.source === 'lastfm' || r.source === 'musicbrainz') && tags.length) {
    const v = classifyTags(tags);
    return { ...base, family: v.family, families: v.families, sub: v.sub, status: v.family ? 'found' : 'none' };
  }
  const families: Partial<Record<FamilySlug, number>> = {};
  for (const [k, v] of Object.entries(r.families ?? {})) if (isFamilySlug(k) && Number.isFinite(v)) families[k] = v;
  return {
    ...base,
    family: isFamilySlug(r.family) ? r.family : null,
    families,
    sub: isSubSlug(r.sub) ? r.sub : null,
    status: r.status === 'none' ? 'none' : 'found',
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
