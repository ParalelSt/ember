import 'server-only';
import path from 'node:path';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { songKey } from '@/lib/songKey';
import { serverLogger } from '@/lib/logger/server';
import {
  readHints,
  searchSongsterr,
  toHints,
  type SongsterrSongHint,
} from '@/lib/songsterr';
import type { TabKind, TabSummary } from '@/lib/tabSources';

/** The one tab store (docs/tabs-rebuild.md section 3): PocketBase `tabs`,
 *  a row per tab, for files people add and tabs Ember generates alike.
 *
 *  Everything here takes the ADMIN client, which bypasses the collection's
 *  rules, so visibility and delete permission are enforced here, mirroring
 *  the rules in pocketbase/pb_hooks/ensure_tabs.pb.js:
 *
 *   - see a row: it is shared, or it is yours
 *   - delete a row: it is yours, or you are an admin
 *
 *  Lookup is by song_key (lib/songKey.ts), so "Song (Remastered 2011)" and
 *  "Song" find the same tabs, plus the exact track the tab was added for. */

export type { TabKind, TabSummary, TabSource } from '@/lib/tabSources';
export { orderSources } from '@/lib/tabSources';

/** Who is asking: the signed-in member as lib/auth hands it over. */
export interface TabViewer {
  id: string;
  isAdmin: boolean;
}

export interface TabQuery {
  title?: string;
  artist?: string;
  /** The app's compound track id (youtube:abc, upload:xyz). */
  trackId?: string;
}

// ── pure helpers ──────────────────────────────────────────────────────────

export function songKeyOf(song: { title?: string; artist?: string }): string {
  return songKey({ title: song.title ?? '', artist: song.artist ?? '' });
}

function splitKey(key: string): { title: string; artist: string } {
  const i = key.lastIndexOf('::');
  if (i < 0) return { title: key, artist: '' };
  return { title: key.slice(0, i), artist: key.slice(i + 2) };
}

/** 'song.gp5' -> 'gp5'. */
export function formatOf(filename: string): string {
  return path.extname(filename).replace('.', '').toLowerCase();
}

export function kindOf(row: RecordModel): TabKind {
  return row.kind === 'generated' ? 'generated' : 'file';
}

export function canView(row: RecordModel, viewer: TabViewer): boolean {
  return row.shared === true || (!!row.user && row.user === viewer.id);
}

export function canDelete(row: RecordModel, viewer: TabViewer): boolean {
  return viewer.isAdmin || (!!row.user && row.user === viewer.id);
}

/** Does this row belong to the song (or the exact track) being asked about?
 *  Titles must agree after normalization; an unknown artist on either side
 *  does not veto a title match (a file named after the song alone). */
export function matchesQuery(row: RecordModel, q: TabQuery): boolean {
  if (q.trackId && row.track_key === q.trackId) return true;
  if (!q.title) return false;
  const rowKey = splitKey(String(row.song_key || '') || songKeyOf(row as { title?: string; artist?: string }));
  const want = splitKey(songKeyOf(q));
  if (!rowKey.title || rowKey.title !== want.title) return false;
  return !rowKey.artist || !want.artist || rowKey.artist === want.artist;
}

/** Files first, then generated; newest first inside each. */
export function sortTabs(rows: RecordModel[]): RecordModel[] {
  const rank = (r: RecordModel) => (kindOf(r) === 'file' ? 0 : 1);
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || String(b.created ?? '').localeCompare(String(a.created ?? '')),
  );
}

export function mapTab(row: RecordModel, viewer: TabViewer, addedBy: string | null = null): TabSummary {
  const kind = kindOf(row);
  const file = String(row.file ?? '');
  const trackId = (row.track_key as string) || null;
  return {
    id: row.id,
    kind,
    title: (row.title as string) || 'Untitled',
    artist: (row.artist as string) || 'Unknown artist',
    instrument: (row.instrument as string) || null,
    trackId,
    ext: path.extname(file),
    format: (row.format as string) || formatOf(file),
    shared: row.shared === true,
    mine: !!row.user && row.user === viewer.id,
    canDelete: canDelete(row, viewer),
    offsetMs: Number(row.offset_ms) || 0,
    addedBy,
    downloadUrl:
      kind === 'generated' && trackId
        ? `/api/tabs/generated/${encodeURIComponent(trackId)}`
        : `/api/tabs/files/${row.id}/download`,
  };
}

/** What an old row (from before the store) is missing: song_key, kind and
 *  format. `shared` is deliberately NOT touched: an old row was uploaded as
 *  private and stays private. Null when nothing is missing. */
export function backfillPatch(row: RecordModel): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (!row.song_key) patch.song_key = songKeyOf(row as { title?: string; artist?: string });
  if (!row.kind) patch.kind = 'file';
  if (!row.format && row.file) patch.format = formatOf(String(row.file));
  return Object.keys(patch).length ? patch : null;
}

// ── PocketBase access ─────────────────────────────────────────────────────

let backfilled: Promise<void> | null = null;

/** For tests: let the next call backfill again. */
export function resetBackfill(): void {
  backfilled = null;
}

/** Fill in the store fields of rows written before them. Once per server
 *  process; a failure is logged and retried on the next call. */
export function backfillTabRows(pb: PocketBase): Promise<void> {
  if (!backfilled) {
    backfilled = (async () => {
      const rows = await pb.collection('tabs').getFullList({ filter: 'song_key = "" || kind = "" || format = ""' });
      for (const row of rows) {
        const patch = backfillPatch(row);
        if (patch) await pb.collection('tabs').update(row.id, patch);
      }
    })().catch((e) => {
      backfilled = null;
      serverLogger.error('tabs', 'backfill failed', undefined, e);
    });
  }
  return backfilled;
}

/** Tabs the viewer may see, optionally for one song or track, sorted files
 *  first. With no title and no track, every visible tab (the library). */
export async function findTabs(
  pb: PocketBase,
  viewer: TabViewer,
  q: TabQuery,
  opts: { kind?: TabKind } = {},
): Promise<RecordModel[]> {
  await backfillTabRows(pb);

  const forSong = !!(q.title || q.artist || q.trackId);
  // An artist alone names no song.
  if (forSong && !q.title && !q.trackId) return [];

  const parts = [pb.filter('(shared = true || user = {:me})', { me: viewer.id })];
  if (forSong) {
    const or: string[] = [];
    // Rows with no key yet (from before the store) are matched in TS below.
    if (q.title) or.push(pb.filter('song_key ~ {:t} || song_key = ""', { t: `${splitKey(songKeyOf(q)).title}::` }));
    if (q.trackId) or.push(pb.filter('track_key = {:id}', { id: q.trackId }));
    parts.push(`(${or.join(' || ')})`);
  }
  if (opts.kind === 'generated') parts.push('kind = "generated"');
  if (opts.kind === 'file') parts.push('kind != "generated"');

  const rows = await pb.collection('tabs').getList(1, 200, { filter: parts.join(' && '), sort: '-created' });
  // The filter narrows; this decides. Contains-matching on the title can
  // over-fetch, and visibility must never rest on a query string alone.
  const found = sortTabs(
    rows.items.filter(
      (r) =>
        canView(r, viewer) &&
        (!forSong || matchesQuery(r, q)) &&
        (!opts.kind || kindOf(r) === opts.kind),
    ),
  );
  // A row the one-time pass missed (written by an older build after it ran)
  // is filled in as soon as someone finds it.
  for (const r of found) {
    const patch = backfillPatch(r);
    if (!patch) continue;
    Object.assign(r, patch);
    await pb.collection('tabs').update(r.id, patch).catch((e) => {
      serverLogger.error('tabs', 'backfill of a found row failed', { id: r.id }, e);
    });
  }
  return found;
}

/** Display names of the members who added these rows, by user id. A name
 *  that cannot be read is simply missing: the chip then says "someone". */
export async function addedByNames(pb: PocketBase, rows: RecordModel[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => String(r.user ?? '')).filter(Boolean))];
  await Promise.all(
    ids.map(async (id) => {
      const user = await pb.collection('users').getOne(id).catch(() => null);
      const name = String(user?.name ?? '').trim();
      if (name) names.set(id, name);
    }),
  );
  return names;
}

/** Every row for a song regardless of who can see it: hints are public
 *  Songsterr metadata, so reading them from a private row leaks nothing. */
async function rowsForSong(pb: PocketBase, title: string, artist: string): Promise<RecordModel[]> {
  const t = `${splitKey(songKeyOf({ title, artist })).title}::`;
  const rows = await pb.collection('tabs').getFullList({ filter: pb.filter('song_key ~ {:t}', { t }) });
  return rows.filter((r) => matchesQuery(r, { title, artist }));
}

/** Songsterr hints for a song, fetched once and kept on its tab rows: a row
 *  that already carries them answers without a search. Null when Songsterr
 *  could not be asked. */
export async function hintsFor(
  pb: PocketBase,
  title: string,
  artist: string,
  search: typeof searchSongsterr = searchSongsterr,
): Promise<SongsterrSongHint[] | null> {
  const rows = await rowsForSong(pb, title, artist);
  for (const r of rows) {
    const h = readHints(r.hints);
    if (h) return h.songs;
  }
  const songs = await search(title, artist);
  if (songs) {
    const hints = toHints(songs);
    for (const r of rows) {
      await pb.collection('tabs').update(r.id, { hints }).catch((e) => {
        serverLogger.error('tabs', 'saving hints failed', { id: r.id }, e);
      });
    }
  }
  return songs;
}

/** The row for a generated tab, created if it is missing. Generated tabs
 *  are shared like the audio they come from; `userId` is whoever asked for
 *  it (null when recorded after the fact for a tab already on disk). */
export async function recordGenerated(
  pb: PocketBase,
  g: { trackId: string; title: string; artist: string; userId: string | null; file: string },
  search: typeof searchSongsterr = searchSongsterr,
): Promise<RecordModel> {
  const existing = await pb
    .collection('tabs')
    .getList(1, 1, { filter: pb.filter('track_key = {:id} && kind = "generated"', { id: g.trackId }) });
  if (existing.items[0]) return existing.items[0];

  const created = await pb.collection('tabs').create({
    user: g.userId,
    title: g.title.slice(0, 200) || 'Untitled',
    artist: g.artist.slice(0, 200),
    instrument: 'Guitar',
    file: g.file,
    kind: 'generated',
    format: 'alphatex',
    shared: true,
    song_key: songKeyOf(g),
    track_key: g.trackId,
    offset_ms: 0,
  });
  // Best effort: the tab works without hints.
  await hintsFor(pb, g.title, g.artist, search).catch((e) => {
    serverLogger.error('tabs', 'hints for generated tab failed', { trackId: g.trackId }, e);
  });
  return created;
}
