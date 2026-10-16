import { artistKey } from './artistKey';
import { familyOf, isFamilySlug, type SubSlug } from './taxonomy';
import type { ArtistGenre } from './tagger';

export interface OverrideBody {
  /** A family slug, or null for "in no family" (kept out of every mix). */
  family: string | null;
  sub?: string | null;
  name?: string;
}

/** An admin's manual family for an artist as the row to store, or an
 *  error message for a body that does not make sense. The manual row is
 *  never replaced by a lookup (lib/genres/tagger needsLookup). */
export function manualOverride(rawKey: string, body: OverrideBody | null, existing: ArtistGenre | undefined, now: number): ArtistGenre | string {
  const key = artistKey(rawKey);
  if (!key) return 'artist required';
  if (!body || !('family' in body)) return 'family required (a family slug, or null)';
  const family = body.family;
  if (family !== null && !isFamilySlug(family)) return `unknown family "${String(family)}"`;
  let sub: SubSlug | null = null;
  if (family && body.sub) {
    const subs = familyOf(family)?.subs ?? [];
    const found = subs.find((s) => s.slug === body.sub);
    if (!found) return `"${body.sub}" is not a part of ${family}`;
    sub = found.slug;
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : existing?.name ?? rawKey;
  return {
    key,
    name,
    artistId: existing?.artistId ?? null,
    family: family ?? null,
    families: family ? { [family]: 1 } : {},
    sub,
    tags: existing?.tags ?? [],
    source: 'manual',
    status: family ? 'found' : 'none',
    fetchedAt: new Date(now).toISOString(),
  };
}
