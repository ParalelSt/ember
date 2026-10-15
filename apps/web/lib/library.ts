import type { LibraryBadgeKind } from './libraryIcons';
import { countLabel, playlistCover, type CollectionSummary } from './collections';
import { formatCount } from './format';

/** The phone Library (the owner's "Spotify list" pick): filter chips, a
 *  Recents / Alphabetical sort, a list or grid view, and one list where the
 *  system collections come first, then the playlists. Everything here is
 *  pure, so the page only wires hooks to it. */

export type LibraryChip = 'playlists' | 'mixes' | 'downloaded';
export type LibrarySort = 'recents' | 'alpha';
export type LibraryView = 'list' | 'grid';
export type LibraryItemKind = 'liked' | 'recent' | 'uploads' | 'downloaded' | 'playlist' | 'mix';

/** What a row's art shows: the Liked songs heart, a system collection's
 *  song mosaic with its corner badge, or a playlist's own cover / mosaic. */
export type LibraryCoverSpec =
  | { kind: 'liked' }
  | { kind: 'badge'; badge: LibraryBadgeKind; arts: string[] }
  | { kind: 'art'; src: string | null; mosaic?: string[] };

export interface LibraryItem {
  key: string;
  kind: LibraryItemKind;
  title: string;
  subtitle: string;
  /** Absent on the Downloaded row: tapping it turns the Downloaded chip on. */
  href?: string;
  downloaded: boolean;
  pinned: boolean;
  cover: LibraryCoverSpec;
  /** A playlist's id, so opening it can move it up Recents. */
  playlistId?: string;
}

const SYSTEM_ORDER: readonly LibraryItemKind[] = ['liked', 'recent', 'uploads', 'downloaded'];
export const isSystemItem = (item: Pick<LibraryItem, 'kind'>) => SYSTEM_ORDER.includes(item.kind);

/** The chips, in order. Mixes only once there are mixes. */
export function libraryChips(hasMixes: boolean): { id: LibraryChip; label: string }[] {
  return [
    { id: 'playlists', label: 'Playlists' },
    ...(hasMixes ? [{ id: 'mixes' as const, label: 'Mixes' }] : []),
    { id: 'downloaded', label: 'Downloaded' },
  ];
}

/** Tapping the active chip clears it; any other chip takes its place. */
export function nextChip(active: LibraryChip | null, tapped: LibraryChip): LibraryChip | null {
  return active === tapped ? null : tapped;
}

function matchesChip(item: LibraryItem, chip: LibraryChip | null): boolean {
  if (!chip) return true;
  if (chip === 'playlists') return item.kind === 'playlist';
  if (chip === 'mixes') return item.kind === 'mix';
  // The Downloaded row IS this filter, so it does not list itself.
  return item.downloaded && item.kind !== 'downloaded';
}

/** Case- and accent-blind, so "cafe" finds "Café". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();

/** The list the page shows: the chip and the search narrow it, the system
 *  collections stay first in their fixed order, and the rest follow the
 *  sort. Recents keeps the order it was given (pinned, then last opened);
 *  Alphabetical keeps pinned ones on top too, the rest A to Z. */
export function arrangeLibrary(
  items: readonly LibraryItem[],
  { chip = null, sort = 'recents', query = '' }: { chip?: LibraryChip | null; sort?: LibrarySort; query?: string } = {},
): LibraryItem[] {
  const q = fold(query.trim());
  const kept = items.filter((i) => matchesChip(i, chip) && (!q || fold(i.title).includes(q)));
  const system = kept
    .filter(isSystemItem)
    .sort((a, b) => SYSTEM_ORDER.indexOf(a.kind) - SYSTEM_ORDER.indexOf(b.kind));
  const rest = kept.filter((i) => !isSystemItem(i));
  if (sort === 'alpha') {
    const pinned = rest.filter((i) => i.pinned);
    const others = rest
      .filter((i) => !i.pinned)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
    return [...system, ...pinned, ...others];
  }
  return [...system, ...rest];
}

/** A system collection cover's look from its songs' covers: four or more
 *  distinct ones make a 2x2 mosaic, one to three show the first full size,
 *  none leaves the plain coloured tile. */
export type BadgeCoverLook = { mode: 'mosaic'; tiles: string[] } | { mode: 'single'; src: string } | { mode: 'plain' };

export function badgeCoverLook(arts: readonly (string | null | undefined)[]): BadgeCoverLook {
  const distinct: string[] = [];
  for (const a of arts) {
    if (a && !distinct.includes(a)) distinct.push(a);
    if (distinct.length === 4) break;
  }
  if (distinct.length >= 4) return { mode: 'mosaic', tiles: distinct };
  if (distinct.length > 0) return { mode: 'single', src: distinct[0] };
  return { mode: 'plain' };
}

/** The first few distinct covers of a song list (enough for a mosaic). */
export function firstArts(tracks: readonly { artworkUrl?: string | null }[], max = 4): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    if (t.artworkUrl && !out.includes(t.artworkUrl)) out.push(t.artworkUrl);
    if (out.length === max) break;
  }
  return out;
}

type Songs = readonly { artworkUrl?: string | null }[];

export interface LibraryInput {
  liked: Songs;
  history: Songs;
  uploads: Songs;
  /** In Recents order, each saying whether it is pinned (useNavPlaylists). */
  playlists: readonly (CollectionSummary & { pinned?: boolean })[];
  /** Pin ids with a finished download ('liked', 'recent', 'uploads' or a playlist id). */
  downloadedIds: ReadonlySet<string>;
}

function playlistSubtitle(p: CollectionSummary): string {
  if (p.sharedBy) return `Playlist · ${p.sharedBy.name}`;
  return typeof p.trackCount === 'number' ? `Playlist · ${countLabel(p.trackCount)}` : 'Playlist';
}

/** Every item the phone Library can show, before the chip, search and sort:
 *  Liked songs, Recently played, Uploads, Downloaded (only when something
 *  is downloaded), then the playlists. */
export function buildLibraryItems({ liked, history, uploads, playlists, downloadedIds }: LibraryInput): LibraryItem[] {
  const has = (id: string) => downloadedIds.has(id);
  const items: LibraryItem[] = [
    {
      key: 'liked',
      kind: 'liked',
      title: 'Liked songs',
      subtitle: `Playlist · ${countLabel(liked.length)}`,
      href: '/library/liked',
      downloaded: has('liked'),
      pinned: false,
      cover: { kind: 'liked' },
    },
    {
      key: 'recent',
      kind: 'recent',
      title: 'Recently played',
      subtitle: `Auto playlist · ${countLabel(history.length)}`,
      href: '/library/recent',
      downloaded: has('recent'),
      pinned: false,
      cover: { kind: 'badge', badge: 'recent', arts: firstArts(history) },
    },
    {
      key: 'uploads',
      kind: 'uploads',
      title: 'Uploads',
      subtitle: `Uploads · ${countLabel(uploads.length)}`,
      href: '/library/uploads',
      downloaded: has('uploads'),
      pinned: false,
      cover: { kind: 'badge', badge: 'uploads', arts: firstArts(uploads) },
    },
  ];

  const playlistItems: LibraryItem[] = playlists.map((p) => {
    const id = p.ref.kind === 'playlist' ? p.ref.id : p.pinId;
    return {
      key: `playlist:${id}`,
      kind: 'playlist',
      title: p.title,
      subtitle: playlistSubtitle(p),
      href: p.href,
      downloaded: p.downloaded,
      pinned: !!p.pinned,
      cover: { kind: 'art', ...playlistCover(p.artworkUrl, p.trackArtworks) },
      playlistId: id,
    };
  });

  // The Downloaded row: what is downloaded, counted, with its covers.
  const systemDownloads = [
    { on: has('liked'), songs: liked },
    { on: has('recent'), songs: history },
    { on: has('uploads'), songs: uploads },
  ].filter((s) => s.on);
  const playlistDownloads = playlists.filter((p) => p.downloaded);
  const downloadCount = systemDownloads.length + playlistDownloads.length;
  if (downloadCount > 0) {
    const songs =
      systemDownloads.reduce((n, s) => n + s.songs.length, 0) +
      playlistDownloads.reduce((n, p) => n + (p.trackCount ?? 0), 0);
    const arts = [
      ...systemDownloads.flatMap((s) => firstArts(s.songs)),
      ...playlistDownloads.flatMap((p) => (p.artworkUrl ? [p.artworkUrl] : (p.trackArtworks ?? []))),
    ];
    items.push({
      key: 'downloaded',
      kind: 'downloaded',
      title: 'Downloaded',
      subtitle: songs > 0 ? `${formatCount(downloadCount, 'playlist')} · ${countLabel(songs)}` : formatCount(downloadCount, 'playlist'),
      downloaded: true,
      pinned: false,
      cover: { kind: 'badge', badge: 'downloaded', arts },
    });
  }
  return [...items, ...playlistItems];
}

/** The list or grid choice, remembered per device. */
export const LIBRARY_VIEW_KEY = 'ember.library.view';

export function readLibraryView(storage?: Pick<Storage, 'getItem'>): LibraryView {
  try {
    // Reading localStorage itself can throw (blocked site data), so inside the try.
    return (storage ?? globalThis.localStorage)?.getItem(LIBRARY_VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function writeLibraryView(view: LibraryView, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(LIBRARY_VIEW_KEY, view);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}
