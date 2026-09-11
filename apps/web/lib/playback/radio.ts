import { songKey } from '../songKey';
import type { PlaybackContext, Track } from '../../types/track';

/** Radio ranking: turn a raw recommendation list into the tracks to append at
 *  the end of the queue. Pure, so every rule below is testable without the
 *  network, a store or a player; the provider keeps the fetch, the
 *  fetching-for ref, the breadcrumbs and the queue write. */

export interface RankRadioInput {
  /** Raw recommendations for the seed track, in the API's own order. */
  pool: Track[];
  /** The queue as it stands, used to block repeats and variants. */
  queue: Track[];
  /** The track the radio was seeded from. */
  current: Track;
  /** The user's play history; repeated ids raise a track's rank. */
  history: Track[];
  /** The user's liked tracks; breaks ties between equally played tracks. */
  liked: Track[];
  /** Where the queue was started from; an artist queue drifts away from that
   *  artist once their catalog runs out. */
  context: PlaybackContext | null;
}

/** How many known (already played) tracks open the extension, so the first
 *  thing radio plays is something the user is known to like. */
const FRONT_LOAD_MAX = 2;

/** After the front load, one known track per this many merged positions; the
 *  rest are fresh, so radio keeps introducing new music. */
const WEAVE_EVERY = 3;

export function rankRadioPool({ pool, queue, current, history, liked, context }: RankRadioInput): Track[] {
  // Block re-playing the current song or any variant of it, plus variants of
  // anything already queued. songKey() ignores "(Official Video)" etc.
  const blockedKeys = new Set<string>([songKey(current), ...queue.map(songKey)]);
  const queuedIds = new Set(queue.map((q) => q.id));
  const seenKeys = new Set<string>();
  let candidates = pool.filter((t) => {
    if (t.id === current.id || queuedIds.has(t.id)) return false;
    const k = songKey(t);
    if (blockedKeys.has(k) || seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  // Artist context drifts to other artists once the catalog runs out.
  if (context?.type === 'artist' && context.artistName) {
    const targetArtist = context.artistName.toLowerCase();
    candidates = candidates.filter((t) => (t.artist ?? '').toLowerCase() !== targetArtist);
  }

  const playCount = new Map<string, number>();
  for (const t of history) playCount.set(t.id, (playCount.get(t.id) ?? 0) + 1);
  const likedIds = new Set(liked.map((t) => t.id));

  // Survivors the user has played before, re-ranked by personal play count
  // (liked breaks a tie); everything else keeps the API's order.
  const known = candidates
    .filter((t) => playCount.has(t.id))
    .sort((a, b) => {
      const ca = playCount.get(a.id) ?? 0;
      const cb = playCount.get(b.id) ?? 0;
      if (cb !== ca) return cb - ca;
      return Number(likedIds.has(b.id)) - Number(likedIds.has(a.id));
    });
  const fresh = candidates.filter((t) => !playCount.has(t.id));

  const merged: Track[] = [];
  let ki = 0;
  let fi = 0;
  const frontLoad = Math.min(FRONT_LOAD_MAX, known.length);
  while (ki < frontLoad) merged.push(known[ki++]);
  while (ki < known.length || fi < fresh.length) {
    if (ki < known.length && merged.length % WEAVE_EVERY === 0) merged.push(known[ki++]);
    else if (fi < fresh.length) merged.push(fresh[fi++]);
    else if (ki < known.length) merged.push(known[ki++]);
  }
  return merged;
}
