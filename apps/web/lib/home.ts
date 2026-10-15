import { playlistCover, type CollectionIcon, type CollectionSummary } from './collections';
import type { LiveCarlist } from '../types/track';

/** The phone Home's pure parts: which collections go in the quick grid at
 *  the top, and in what order. No React, so a plain test can import it. */

/** Three rows of two under the filter chips (the owner's pick). */
export const QUICK_MAX = 6;

export interface QuickPick {
  key: string;
  title: string;
  href: string;
  src: string | null;
  icon: CollectionIcon | 'car' | null;
  /** Four song covers for a 2x2 mosaic (lib/collections playlistCover). */
  mosaic?: string[];
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
    picks.push({ key: p.pinId, title: p.title, href: p.href, icon: null, ...playlistCover(p.artworkUrl, p.trackArtworks) });
  }
  return picks.slice(0, QUICK_MAX);
}

/** The phone Home's rows below the quick grid. `mixes` and `charts` are the
 *  planned genre rows (docs/superpowers/plans, genre charts and mixes): they
 *  have a place in the order and a chip already, and appear once the page
 *  has content for them. */
export type HomeRowKey = 'mixes' | 'history' | 'recommended' | 'trending' | 'charts' | 'playlists' | 'friends';

/** The owner's order B: mixes and discovery early, your playlists late. */
export const PHONE_ORDER: readonly HomeRowKey[] = [
  'mixes',
  'history',
  'recommended',
  'trending',
  'charts',
  'playlists',
  'friends',
];

export type HomeFilter = 'all' | 'playlists' | 'mixes' | 'charts';

/** The filter chips at the top. `rows` is what the chip keeps (null: all
 *  of them); the quick grid stays under All and Playlists. */
export const HOME_FILTERS: readonly { id: HomeFilter; label: string; rows: readonly HomeRowKey[] | null; quickGrid: boolean }[] = [
  { id: 'all', label: 'All', rows: null, quickGrid: true },
  { id: 'playlists', label: 'Playlists', rows: ['playlists'], quickGrid: true },
  { id: 'mixes', label: 'Mixes', rows: ['mixes'], quickGrid: false },
  { id: 'charts', label: 'Charts', rows: ['charts'], quickGrid: false },
];

/** The chips worth showing: All always, the others only while one of
 *  their rows has something in it. So Mixes and Charts turn up by
 *  themselves once those rows exist. */
export function homeChips(available: ReadonlySet<HomeRowKey>): { id: HomeFilter; label: string }[] {
  return HOME_FILTERS.filter((f) => f.rows === null || f.rows.some((r) => available.has(r))).map(({ id, label }) => ({ id, label }));
}

/** What a filter shows: the quick grid or not, and its rows in order B,
 *  only those with content. A filter whose chip is gone (its rows emptied)
 *  falls back to All. */
export function phoneHomeView(
  filter: HomeFilter,
  available: ReadonlySet<HomeRowKey>,
): { filter: HomeFilter; quickGrid: boolean; rows: HomeRowKey[] } {
  const chip = homeChips(available).some((c) => c.id === filter) ? filter : 'all';
  const def = HOME_FILTERS.find((f) => f.id === chip)!;
  const rows = PHONE_ORDER.filter((r) => available.has(r) && (def.rows === null || def.rows.includes(r)));
  return { filter: chip, quickGrid: def.quickGrid, rows };
}
