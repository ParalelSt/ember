import type { CollectionIcon, CollectionSummary } from './collections';
import type { LiveCarlist } from '../types/track';

/** The phone Home's pure parts: which collections go in the quick grid at
 *  the top, and in what order. No React, so a plain test can import it. */

/** At most four rows of two, like Spotify's. */
export const QUICK_MAX = 8;

export interface QuickPick {
  key: string;
  title: string;
  href: string;
  src: string | null;
  icon: CollectionIcon | 'car' | null;
}

/** Your playlists with the one playing now (or last played: the player
 *  keeps its context) moved to the front. The server already lists them
 *  newest first, and nothing else records when a playlist was last played
 *  or changed, so that order stands behind it. */
export function recentFirst(
  playlists: readonly CollectionSummary[],
  playingPlaylistId: string | null | undefined,
): CollectionSummary[] {
  if (!playingPlaylistId) return [...playlists];
  const at = playlists.findIndex((p) => p.ref.kind === 'playlist' && p.ref.id === playingPlaylistId);
  if (at <= 0) return [...playlists];
  return [playlists[at], ...playlists.slice(0, at), ...playlists.slice(at + 1)];
}

/** The quick grid: Liked songs, then a live carlist (it is happening now),
 *  then your playlists, up to QUICK_MAX tiles. */
export function quickPicks({
  liked,
  playlists,
  carlist,
  playingPlaylistId,
}: {
  liked: CollectionSummary | undefined;
  playlists: readonly CollectionSummary[];
  carlist: LiveCarlist | null | undefined;
  playingPlaylistId?: string | null;
}): QuickPick[] {
  const picks: QuickPick[] = [];
  if (liked) picks.push({ key: liked.pinId, title: liked.title, href: liked.href, src: null, icon: liked.icon });
  if (carlist) {
    picks.push({ key: `carlist-${carlist.id}`, title: carlist.name || 'Carlist', href: `/session/${carlist.id}`, src: null, icon: 'car' });
  }
  for (const p of recentFirst(playlists, playingPlaylistId)) {
    picks.push({ key: p.pinId, title: p.title, href: p.href, src: p.artworkUrl, icon: null });
  }
  return picks.slice(0, QUICK_MAX);
}
