/** The "New releases" row's payload and row caps (docs/new-releases-plan.md).
 *  Types and constants only, so the server rules, the route and the client
 *  share one definition without the client pulling in a server module. */

export type NewReleaseKind = 'album' | 'ep' | 'single';

/** Which half of the row a tile belongs to: a liked artist's own release, or
 *  a suggestion from a genre the member plays. */
export type NewReleaseFrom = 'liked' | 'similar';

export interface NewReleaseItem {
  browseId: string;
  title: string;
  kind: NewReleaseKind;
  artist: string;
  artistId: string | null;
  artworkUrl: string | null;
  year: number | null;
  /** ISO time this server first saw the release. */
  firstSeenAt: string;
  from: NewReleaseFrom;
}

/** GET /api/new-releases. `releases` is in row order, liked first. */
export interface NewReleasesPayload {
  releases: NewReleaseItem[];
  refreshedAt: string | null;
  stale: boolean;
}

/** Row caps, per member. */
export const MINE_MAX = 12;
export const MINE_PER_ARTIST = 2;
export const SIMILAR_MAX = 8;
export const SIMILAR_PER_ARTIST = 1;
export const ROW_MAX = MINE_MAX + SIMILAR_MAX;
