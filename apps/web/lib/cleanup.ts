import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type PocketBase from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';

/** A track is stale when nobody has played it for this long. */
export const STALE_AFTER_DAYS = 14;

const ROOT = path.resolve(process.cwd(), '..', '..');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');
const CACHE_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.mp4'] as const;

export interface CleanupReport {
  scanned: number;
  protectedCount: number;
  deletedRows: number;
  deletedFiles: number;
  freedBytes: number;
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

  // serverLogger only records errors; the summary goes to the server console
  // (the terminal running ./start-static.sh) so the host can see what ran.
  console.log(`[cleanup] ${dryRun ? 'DRY RUN' : 'done'}`, JSON.stringify(report));
  return report;
}
