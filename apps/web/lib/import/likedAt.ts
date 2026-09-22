/** When an imported like says it happened.
 *
 *  A transfer brings in songs a person liked somewhere else, sometimes
 *  thousands of them. They must not bury the likes made inside Ember, so an
 *  imported like is dated below every real one the person already had, and
 *  the transfer's own songs keep their source order underneath (owner
 *  decisions A and F).
 *
 *  Sources that carry a real time (Exportify's `Added At`, Last.fm's
 *  `date`, Deezer's `time_add`) keep it and skip all of this. The rest get a
 *  synthetic one, a second apart so the order survives a sort. Pure. */

/** How the source lists its songs. `unknown` is treated as newest-first,
 *  which is what a liked-songs list almost always is. */
export type SourceOrder = 'newest-first' | 'oldest-first' | 'unknown';

/** Clear space between the newest imported like and the oldest real one, so
 *  the two groups never interleave. */
export const TRANSFER_GAP_MS = 60_000;

/** The moment the newest song of a transfer is dated at: below the person's
 *  oldest existing like, and never in the future of the job itself. */
export function transferBase(oldestExistingLikedAt: number | null, jobCreated: number): number {
  const floor = oldestExistingLikedAt === null ? jobCreated : Math.min(oldestExistingLikedAt, jobCreated);
  return floor - TRANSFER_GAP_MS;
}

/** The date for one source song, one second below the song above it. */
export function syntheticLikedAt(base: number, order: SourceOrder, total: number, position: number): number {
  const fromNewest = order === 'oldest-first' ? Math.max(0, total - 1 - position) : position;
  return base - fromNewest * 1000;
}
