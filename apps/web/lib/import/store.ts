import 'server-only';
import type PocketBase from 'pocketbase';
import type { Track } from '@/types/track';
import { upsertTrack } from '@/lib/upsertTrack';
import { countItems, playlistPosition, type ItemStatus } from '@/lib/import/jobState';
import { itemFromRecord, itemRecord, jobFromRecord, pbDate, readyItem } from '@/lib/import/records';
import type { ImportCandidate, ImportItem, ImportJob, ImportSourceKind, SourceItem } from '@/lib/import/types';
import type { ItemResult, JobCounts, JobPatch, JobStore, PendingItem, RunnerJob } from '@/lib/import/runner';

// PocketBase side of imports. Every write goes through the admin client:
// the collections have no create/update rules (ensure_imports.pb.js), so
// only the server moves a job along.

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function status(e: unknown): number | undefined {
  return (e as { status?: number } | undefined)?.status;
}

function runnerJob(r: Record<string, unknown>): RunnerJob {
  const j = jobFromRecord(r);
  return { id: j.id, status: j.status, cursor: j.cursor, total: j.total, source: j.source, playlistId: j.playlistId };
}

function patchRecord(p: JobPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.status !== undefined) out.status = p.status;
  if (p.cursor !== undefined) out.cursor = p.cursor;
  if (p.accepted !== undefined) out.accepted = p.accepted;
  if (p.review !== undefined) out.review = p.review;
  if (p.missing !== undefined) out.missing = p.missing;
  if (p.error !== undefined) out.error = p.error.slice(0, 300);
  if (p.retryAt !== undefined) out.retry_at = p.retryAt === null ? '' : pbDate(p.retryAt);
  if (p.heartbeat !== undefined) out.heartbeat = pbDate(p.heartbeat);
  return out;
}

/** Add a track to a playlist at a position. The same song twice (in the
 *  source, or picked again) trips the (playlist, track) unique index: that
 *  is fine, the track is there. */
export async function addTrackAt(pb: PocketBase, playlistId: string, position: number, track: Track): Promise<void> {
  const trackId = await upsertTrack(pb, track);
  try {
    await pb.collection('playlist_tracks').create({ playlist: playlistId, track: trackId, position });
  } catch (e) {
    if (status(e) !== 400) throw e;
  }
}

export async function jobCounts(pb: PocketBase, jobId: string): Promise<JobCounts> {
  const rows = await pb.collection('import_items').getFullList({ filter: `job = "${esc(jobId)}"`, fields: 'status' });
  return countItems(rows.map((r) => r.status as ItemStatus));
}

/** The runner's heartbeat and its own writes can touch the same record at
 *  once; the SDK's auto-cancel would abort one of them. */
function noAutoCancel(pb: PocketBase): PocketBase {
  pb.autoCancellation(false);
  return pb;
}

export function createJobStore(getAdmin: () => Promise<PocketBase>): JobStore {
  const getPb = () => getAdmin().then(noAutoCancel);
  return {
    async releaseStale(staleBefore) {
      const pb = await getPb();
      const cutoff = pbDate(staleBefore);
      // Running with a silent runner, or paused mid-backoff by one: the
      // runner that would have carried on is gone.
      const rows = await pb.collection('import_jobs').getFullList({
        filter: `(status = "running" || (status = "paused" && retry_at != "")) && (heartbeat = "" || heartbeat < "${cutoff}")`,
      });
      for (const r of rows) await pb.collection('import_jobs').update(r.id, { status: 'queued', runner: '', retry_at: '' });
      return rows.length;
    },

    async claimNext(runnerId, now) {
      const pb = await getPb();
      const next = await pb
        .collection('import_jobs')
        .getList(1, 1, { filter: 'status = "queued"', sort: 'created' })
        .then((l) => l.items[0]);
      if (!next) return null;
      await pb.collection('import_jobs').update(next.id, {
        status: 'running',
        runner: runnerId,
        heartbeat: pbDate(now),
        error: '',
        retry_at: '',
      });
      // Two servers on one PocketBase can race here: the last write wins,
      // and only the runner whose name stuck carries on.
      const check = await pb.collection('import_jobs').getOne(next.id);
      if (check.runner !== runnerId) return null;
      return runnerJob(check);
    },

    async getJob(id) {
      const pb = await getPb();
      try {
        return runnerJob(await pb.collection('import_jobs').getOne(id));
      } catch (e) {
        if (status(e) === 404) return null;
        throw e;
      }
    },

    async updateJob(id, patch) {
      const pb = await getPb();
      await pb.collection('import_jobs').update(id, patchRecord(patch));
    },

    async pendingItems(jobId, fromPosition, limit) {
      const pb = await getPb();
      const list = await pb.collection('import_items').getList(1, limit, {
        filter: `job = "${esc(jobId)}" && status = "pending" && position >= ${Math.max(0, Math.floor(fromPosition))}`,
        sort: 'position',
      });
      return list.items.map((r): PendingItem => {
        const item = itemFromRecord(r);
        return { id: item.id, position: item.position, source: item.source, candidates: item.candidates };
      });
    },

    async saveResults(results: ItemResult[]) {
      const pb = await getPb();
      for (const r of results) {
        await pb.collection('import_items').update(r.itemId, {
          status: r.status,
          video_id: r.videoId ?? '',
          confidence: r.confidence ?? 0,
          candidates: r.candidates,
        });
      }
    },

    async addTrack(playlistId, position, track) {
      await addTrackAt(await getPb(), playlistId, position, track);
    },

    async counts(jobId) {
      return jobCounts(await getPb(), jobId);
    },
  };
}

export interface NewImport {
  userId: string;
  source: ImportSourceKind;
  sourceId: string;
  sourceUrl: string;
  name: string;
  coverUrl: string | null;
  /** Spotify: source items to search for. */
  items?: SourceItem[];
  /** YouTube Music: the playlist's own tracks, accepted as they are. */
  tracks?: Track[];
}

/** The playlist, the queued job and one pending item per source track.
 *  The playlist exists (and shows in the sidebar) before any matching. */
export async function createImportJob(pb: PocketBase, n: NewImport): Promise<{ job: ImportJob; playlistId: string }> {
  noAutoCancel(pb);
  const rows: { item: SourceItem; candidates: ImportCandidate[] }[] = n.tracks
    ? n.tracks.map((t, i) => readyItem(t, i))
    : (n.items ?? []).map((item) => ({ item, candidates: [] }));

  const playlist = await pb.collection('playlists').create({
    user: n.userId,
    name: n.name.slice(0, 120) || 'Imported playlist',
    source_url: n.sourceUrl.slice(0, 500),
  });
  const job = await pb.collection('import_jobs').create({
    user: n.userId,
    source: n.source,
    kind: 'playlist',
    source_id: n.sourceId.slice(0, 120),
    source_url: n.sourceUrl.slice(0, 500),
    name: n.name.slice(0, 200),
    cover_url: (n.coverUrl ?? '').slice(0, 500),
    total: rows.length,
    cursor: 0,
    // Held back until its items exist, or a runner could claim it, find
    // nothing pending and call it done. Queued at the end.
    status: 'paused',
    accepted: 0,
    review: 0,
    missing: 0,
    playlist: playlist.id,
    dismissed: false,
  });
  try {
    await pb.collection('playlists').update(playlist.id, { import_job: job.id });
    // A few at a time: fast enough for 100 rows, gentle on PocketBase.
    for (let i = 0; i < rows.length; i += 10) {
      await Promise.all(
        rows.slice(i, i + 10).map((r) => pb.collection('import_items').create(itemRecord(job.id, r.item, r.candidates))),
      );
    }
    const queued = await pb.collection('import_jobs').update(job.id, { status: 'queued' });
    return { job: jobFromRecord(queued), playlistId: playlist.id };
  } catch (e) {
    // Half an import is worse than none: the playlist goes, and its job and
    // items with it (cascade).
    await pb.collection('playlists').delete(playlist.id).catch(() => {});
    throw e;
  }
}

/** Give the new playlist the source's cover. Best effort: a playlist without
 *  a cover is fine, so any failure is dropped. */
export async function attachCover(pb: PocketBase, playlistId: string, coverUrl: string | null): Promise<void> {
  if (!coverUrl || !/^https:\/\//.test(coverUrl)) return;
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type)) return;
    const blob = await res.blob();
    if (blob.size > 5 * 1024 * 1024) return;
    const fd = new FormData();
    fd.append('artwork', blob, `cover.${type.split('/')[1]}`);
    await pb.collection('playlists').update(playlistId, fd);
  } catch {
    // no cover
  }
}

/** Put a picked track in the playlist for an import item, at its source
 *  position. A re-pick swaps the old track out in place. */
export async function pickItem(pb: PocketBase, job: ImportJob, item: ImportItem, track: Track): Promise<void> {
  const oldVideo = item.videoId;
  const newTrackId = await upsertTrack(pb, track);
  let junction: { id: string } | null = null;
  if (oldVideo && oldVideo !== track.sourceId) {
    try {
      const oldTrack = await pb.collection('tracks').getFirstListItem(`external_id = "youtube:${esc(oldVideo)}"`);
      junction = await pb
        .collection('playlist_tracks')
        .getFirstListItem(`playlist = "${esc(job.playlistId)}" && track = "${oldTrack.id}"`);
    } catch (e) {
      if (status(e) !== 404) throw e;
    }
  }
  if (junction) {
    try {
      await pb.collection('playlist_tracks').update(junction.id, { track: newTrackId });
    } catch (e) {
      // The picked song is already elsewhere in the playlist: keep that
      // copy and drop the wrong one.
      if (status(e) !== 400) throw e;
      await pb.collection('playlist_tracks').delete(junction.id);
    }
  } else {
    await addTrackAt(pb, job.playlistId, playlistPosition(item.position), track);
  }

  const known = item.candidates.some((c) => c.track.sourceId === track.sourceId);
  await pb.collection('import_items').update(item.id, {
    status: 'resolved',
    video_id: track.sourceId,
    // A song found by searching joins the candidates, so a later re-match
    // still lists it.
    ...(known
      ? {}
      : {
          candidates: [
            ...item.candidates,
            { track, artists: track.artist ? [track.artist] : [], videoType: null, explicit: null, score: 0, reasons: ['Picked from search'] },
          ],
        }),
  });
  await pb.collection('import_jobs').update(job.id, await jobCounts(pb, job.id));
}

/** "Remove song": leave this source track out of the playlist for good. */
export async function skipItem(pb: PocketBase, job: ImportJob, item: ImportItem): Promise<void> {
  await pb.collection('import_items').update(item.id, { status: 'skipped' });
  await pb.collection('import_jobs').update(job.id, await jobCounts(pb, job.id));
}
