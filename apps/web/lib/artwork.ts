import type { AlbumDetail } from '../types/track';

/** Reuses the thumbnail shape already declared on AlbumDetail (same shape as
 *  AlbumSummary and ArtistPayload's `thumbnails`) rather than redeclaring it. */
type Thumbnail = AlbumDetail['thumbnails'][number];

/** The art the album/artist pages show: today that's just the last
 *  thumbnail's url, null when there isn't one. */
export function pickThumbnail(thumbnails: readonly Thumbnail[] | null | undefined): string | null {
  if (!thumbnails || thumbnails.length === 0) return null;
  return thumbnails[thumbnails.length - 1]?.url ?? null;
}

// placeholderFor(kind) skipped: no per-kind placeholder art paths/classes
// exist in the codebase today (checked components/, app/, lib/ for
// "placeholder"); adding one would invent an asset the brief says not to.
