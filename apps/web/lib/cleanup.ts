import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type PocketBase from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';
import { isDownloading } from '@/lib/sources/youtube';

/** A track is stale when nobody has played it for this long. */
export const STALE_AFTER_DAYS = 14;
/** A cached file with no matching tracks row is only orphaned once it has
 *  sat untouched this long — a fresh download's row is written moments
 *  after the file, so a young unmatched file is a normal race, not a leak. */
export const ORPHAN_CACHE_AFTER_DAYS = 30;

const ROOT = path.resolve(process.cwd(), '..', '..');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');
const CACHE_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.mp4'] as const;
// A plain cached-audio filename: exactly "<videoId>.<ext>", nothing else.
// yt-dlp writes a download as "<videoId>.<ext>.part"/".ytdl" while it's
// still in progress and only the finished file matches this — so an
// in-progress download is excluded by name alone, before isDownloading()
// is even checked. Anything else in MUSIC_DIR (an upload, a stray file) has
// a different shape and never matches either.
const CACHE_FILE_RE = /^([A-Za-z0-9_-]{11})\.(m4a|webm|opus|mp3|mp4)$/;

export interface CleanupReport {
  scanned: number;
  protectedCount: number;
  deletedRows: number;
  deletedFiles: number;
  freedBytes: number;
  orphanScanned: number;
  orphanDeletedFiles: number;
  orphanFreedBytes: number;
  dryRun: boolean;
}

/** Every track id referenced by something a user would miss. Liked songs,
 *  playlist entries, live-session queues and recent searches are all kept
 *  regardless of age — deleting those would visibly break someone's library. */
async function protectedTrackIds(pb: PocketBase): Promise<Set<string>> {
  const keep = new Set<string>();
  const collect = async (collection: string, field = 'track') => {
    try {
      const rows = await pb.collection(collection).getFullList({ fields: `${field}` });
      for (const r of rows) {
        const v = (r as unknown as Record<string, unknown>)[field];
        if (typeof v === 'string' && v) keep.add(v);
      }
    } catch {
      // Collection may not exist on older deployments (sessions/recent_searches
      // arrive with their bootstrap hooks) — absence just means nothing to keep.
    }
  };
  await collect('likes');
  await collect('playlist_tracks');
  await collect('session_tracks');
  await collect('recent_searches');
  return keep;
}

/** Track record ids played within the window — these stay. */
async function recentlyPlayedIds(pb: PocketBase, since: string): Promise<Set<string>> {
  const keep = new Set<string>();
  try {
    const rows = await pb.collection('plays').getFullList({
      filter: `played_at >= "${since}"`,
      fields: 'track',
    });
    for (const r of rows) {
      const v = (r as unknown as Record<string, unknown>).track;
      if (typeof v === 'string' && v) keep.add(v);
    }
  } catch (e) {
    // Failing open (keeping everything) is the safe direction.
    serverLogger.error('cleanup', 'could not read plays — keeping all tracks', undefined, e);
    throw e;
  }
  return keep;
}

function cachedFileFor(videoId: string): string | null {
  for (const ext of CACHE_EXTS) {
    const p = path.join(MUSIC_DIR, `${videoId}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Every videoId a tracks row still points at ("youtube:<videoId>"), so a
 *  cache file for it is not orphaned. Uploads use "upload:<id>" (their audio
 *  lives in the uploads collection's own directory, never MUSIC_DIR) and
 *  never match a cache filename anyway, so they need no special-casing here. */
async function knownVideoIds(pb: PocketBase): Promise<Set<string>> {
  const ids = new Set<string>();
  const rows = await pb.collection('tracks').getFullList({ fields: 'external_id' });
  for (const r of rows) {
    const externalId = String((r as unknown as Record<string, unknown>).external_id ?? '');
    if (externalId.startsWith('youtube:')) ids.add(externalId.slice('youtube:'.length));
  }
  return ids;
}

interface OrphanSweepResult {
  scanned: number;
  deletedFiles: number;
  freedBytes: number;
}

/** Deletes cached audio files in MUSIC_DIR that no tracks row references any
 *  more. runCleanup's own file deletion only ever fires when it deletes the
 *  row it found the file through, so a row deleted some other way (or a
 *  download that crashed before its row was ever written) leaves the file
 *  behind forever without this. Conservative on purpose, since deleting
 *  audio is destructive: only a plain `<videoId>.<ext>` cache file counts
 *  (see CACHE_FILE_RE), a videoId currently downloading is always skipped,
 *  and a file has to sit unmatched for ORPHAN_CACHE_AFTER_DAYS before it
 *  counts as orphaned rather than a fresh download's row not landing yet. */
async function sweepOrphanCacheFiles(pb: PocketBase, dryRun: boolean): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { scanned: 0, deletedFiles: 0, freedBytes: 0 };
  let entries: string[];
  try {
    entries = fs.readdirSync(MUSIC_DIR);
  } catch (e) {
    serverLogger.error('cleanup', 'could not read MUSIC_DIR for orphan sweep', { dir: MUSIC_DIR }, e);
    return result;
  }

  const known = await knownVideoIds(pb);
  const cutoffMs = Date.now() - ORPHAN_CACHE_AFTER_DAYS * 86_400_000;

  for (const name of entries) {
    const m = CACHE_FILE_RE.exec(name);
    if (!m) continue;
    const videoId = m[1];
    if (known.has(videoId) || isDownloading(videoId)) continue;

    result.scanned += 1;
    const file = path.join(MUSIC_DIR, name);
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs >= cutoffMs) continue;
      if (!dryRun) fs.unlinkSync(file);
      result.deletedFiles += 1;
      result.freedBytes += stat.size;
    } catch (e) {
      serverLogger.error('cleanup', 'could not delete orphan cached file', { file }, e);
    }
  }
  return result;
}

/** Delete tracks nobody has played in STALE_AFTER_DAYS, along with their
 *  downloaded audio. Anything liked / in a playlist / in a session / in recent
 *  searches is kept no matter how old. Pass dryRun to report without deleting. */
export async function runCleanup(pb: PocketBase, { dryRun = false } = {}): Promise<CleanupReport> {
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000)
    .toISOString()
    .replace('T', ' ');

  const [keepReferenced, keepRecent] = await Promise.all([
    protectedTrackIds(pb),
    recentlyPlayedIds(pb, cutoff),
  ]);

  const tracks = await pb.collection('tracks').getFullList({ fields: 'id,external_id' });
  const report: CleanupReport = {
    scanned: tracks.length,
    protectedCount: 0,
    deletedRows: 0,
    deletedFiles: 0,
    freedBytes: 0,
    orphanScanned: 0,
    orphanDeletedFiles: 0,
    orphanFreedBytes: 0,
    dryRun,
  };

  for (const row of tracks) {
    const id = String(row.id);
    const externalId = String(row.external_id ?? '');
    // Member uploads are never stale: someone deliberately put them on this
    // server, and deleting the row frees nothing (the audio lives in the
    // uploads collection's own directory, removed only via /api/uploads).
    if (externalId.startsWith('upload:')) {
      report.protectedCount += 1;
      continue;
    }
    if (keepReferenced.has(id) || keepRecent.has(id)) {
      report.protectedCount += 1;
      continue;
    }

    // external_id is "youtube:<videoId>"; the cache is keyed by videoId.
    const videoId = externalId.split(':')[1] ?? '';
    const file = videoId ? cachedFileFor(videoId) : null;

    if (file) {
      try {
        const { size } = fs.statSync(file);
        if (!dryRun) fs.unlinkSync(file);
        report.deletedFiles += 1;
        report.freedBytes += size;
      } catch (e) {
        serverLogger.error('cleanup', 'could not delete cached file', { file }, e);
      }
    }

    try {
      if (!dryRun) await pb.collection('tracks').delete(id);
      report.deletedRows += 1;
    } catch (e) {
      // Usually a lingering relation we didn't account for — leave the row.
      serverLogger.error('cleanup', 'could not delete track row', { id }, e);
    }
  }

  // Run after the stale-row pass above: a row just deleted there has already
  // taken its file with it, and re-reading tracks now means this sweep never
  // mistakes a row this same run just deleted for one that's still live.
  const orphans = await sweepOrphanCacheFiles(pb, dryRun);
  report.orphanScanned = orphans.scanned;
  report.orphanDeletedFiles = orphans.deletedFiles;
  report.orphanFreedBytes = orphans.freedBytes;

  // serverLogger only records errors; the summary goes to the server console
  // (the terminal running ./start-static.sh) so the host can see what ran.
  console.log(`[cleanup] ${dryRun ? 'DRY RUN' : 'done'}`, JSON.stringify(report));
  return report;
}
