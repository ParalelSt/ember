import 'server-only';
import type PocketBase from 'pocketbase';
import type { Track } from '@/types/track';
import { upsertTrack } from '@/lib/upsertTrack';
import { countItems, playlistPosition, type ItemStatus } from '@/lib/import/jobState';
import { itemFromRecord, itemRecord, jobFromRecord, pbDate, pbMillis, readyItem } from '@/lib/import/records';
import { syntheticLikedAt, transferBase, type SourceOrder } from '@/lib/import/likedAt';
import type { ImportCandidate, ImportItem, ImportJob, ImportSourceKind, JobKind, SourceItem } from '@/lib/import/types';
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
  return {
    id: j.id,
    status: j.status,
    cursor: j.cursor,
    total: j.total,
    source: j.source,
    kind: j.kind,
    playlistId: j.playlistId,
    userId: j.userId,
    existing: j.existing,
  };
}

function patchRecord(p: JobPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.status !== undefined) out.status = p.status;
  if (p.cursor !== undefined) out.cursor = p.cursor;
  if (p.accepted !== undefined) out.accepted = p.accepted;
  if (p.review !== undefined) out.review = p.review;
  if (p.missing !== undefined) out.missing = p.missing;
  if (p.existing !== undefined) out.existing = p.existing;
  if (p.error !== undefined) out.error = p.error.slice(0, 300);
  if (p.retryAt !== undefined) out.retry_at = p.retryAt === null ? '' : pbDate(p.retryAt);
  if (p.heartbeat !== undefined) out.heartbeat = p.heartbeat === null ? '' : pbDate(p.heartbeat);
  if (p.runner !== undefined) out.runner = p.runner;
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

/** Like a track for a transfer. The (user, track) unique index makes a
 *  second like of the same song a no-op, which is exactly what a re-run or a
 *  song the person had already liked needs; `created` says which happened so
 *  the Done summary can count them apart, and `id` is the new like. */
export async function likeTrack(
  pb: PocketBase,
  userId: string,
  track: Track,
  likedAt: number | null,
): Promise<{ created: boolean; id: string | null }> {
  const trackId = await upsertTrack(pb, track);
  try {
    const rec = await pb.collection('likes').create({
      user: userId,
      track: trackId,
      liked_at: pbDate(likedAt ?? Date.now()),
      origin: 'import',
    });
    return { created: true, id: rec.id };
  } catch (e) {
    if (status(e) !== 400) throw e;
    return { created: false, id: null };
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

    async claimNext(runnerId, now, avoid) {
      const pb = await getPb();
      const oldest = (filter: string) =>
        pb
          .collection('import_jobs')
          .getList(1, 1, { filter, sort: 'created' })
          .then((l) => l.items[0]);
      const next =
        (avoid ? await oldest(`status = "queued" && id != "${esc(avoid)}"`) : undefined) ??
        (await oldest('status = "queued"'));
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
        return {
          id: item.id,
          position: item.position,
          source: item.source,
          candidates: item.candidates,
          likedAt: item.likedAt,
        };
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
          // Only a like this run made: a re-run that finds it already there
          // keeps the one recorded the first time.
          ...(r.likeId ? { like_id: r.likeId } : {}),
        });
      }
    },

    async addTrack(playlistId, position, track) {
      await addTrackAt(await getPb(), playlistId, position, track);
    },

    async like(userId, track, likedAt) {
      return likeTrack(await getPb(), userId, track, likedAt);
    },

    async hasOtherQueued(jobId) {
      const pb = await getPb();
      const list = await pb
        .collection('import_jobs')
        .getList(1, 1, { filter: `status = "queued" && id != "${esc(jobId)}"` });
      return list.items.length > 0;
    },

    async counts(jobId) {
      return jobCounts(await getPb(), jobId);
    },
  };
}

/** A source song, with the time the source says it was liked when it has
 *  one (Exportify's `Added At`, Last.fm's `date`). */
/** `candidates` is filled only by a source that names the exact video (the
 *  person's own YouTube Music likes), so those items skip the matcher. */
export type NewImportItem = SourceItem & {
  likedAt?: number | null;
  candidates?: ImportCandidate[];
  /** Decided before the job starts (a Google like: an upload to review, or
   *  not music). The runner only works through pending items. */
  status?: 'review' | 'skipped';
};

export interface NewImport {
  userId: string;
  source: ImportSourceKind;
  sourceId: string;
  sourceUrl: string;
  name: string;
  coverUrl: string | null;
  /** Where the accepted songs land. Default: a new playlist. */
  kind?: JobKind;
  /** Spotify and every transfer source: source items to search for. */
  items?: NewImportItem[];
  /** YouTube Music: the playlist's own tracks, accepted as they are. */
  tracks?: Track[];
  /** How the source lists its songs, for dating a transfer's likes. */
  order?: SourceOrder;
}

/** The oldest like the person already has, for placing a transfer's songs
 *  underneath it (lib/import/likedAt.ts). Rows written before
 *  ensure_likes_fields.pb.js backfilled are skipped: an empty date would
 *  sort first and drag the whole transfer back to 1970. */
async function oldestLikedAt(pb: PocketBase, userId: string): Promise<number | null> {
  const list = await pb
    .collection('likes')
    .getList(1, 1, { filter: `user = "${esc(userId)}" && liked_at != ""`, sort: 'liked_at', fields: 'liked_at' });
  return pbMillis(list.items[0]?.liked_at);
}

/** The queued job and one pending item per source track, plus (for a
 *  playlist import) the playlist itself, which exists and shows in the
 *  sidebar before any matching. A transfer has no playlist: its items carry
 *  the date their likes will get instead. */
export async function createImportJob(
  pb: PocketBase,
  n: NewImport,
): Promise<{ job: ImportJob; playlistId: string | null }> {
  noAutoCancel(pb);
  const kind: JobKind = n.kind ?? 'playlist';
  const rows: { item: NewImportItem; candidates: ImportCandidate[] }[] = n.tracks
    ? n.tracks.map((t, i) => readyItem(t, i))
    : (n.items ?? []).map((item) => ({ item, candidates: item.candidates ?? [] }));
  // Uploads a Google likes transfer created waiting for a look count from
  // the start, so the banner is right before the runner gets to it.
  const review = rows.filter((r) => r.item.status === 'review').length;
  const likedAt = kind === 'liked' ? await transferDates(pb, n, rows.length) : null;

  const playlist =
    kind === 'liked'
      ? null
      : await pb.collection('playlists').create({
          user: n.userId,
          name: n.name.slice(0, 120) || 'Imported playlist',
          source_url: n.sourceUrl.slice(0, 500),
        });
  const job = await pb.collection('import_jobs').create({
    user: n.userId,
    source: n.source,
    kind,
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
    review,
    missing: 0,
    existing: 0,
    ...(playlist ? { playlist: playlist.id } : {}),
    dismissed: false,
  });
  try {
    if (playlist) await pb.collection('playlists').update(playlist.id, { import_job: job.id });
    // A few at a time: fast enough for 100 rows, gentle on PocketBase.
    for (let i = 0; i < rows.length; i += 10) {
      await Promise.all(
        rows
          .slice(i, i + 10)
          .map((r) =>
            pb
              .collection('import_items')
              .create(itemRecord(job.id, r.item, r.candidates, likedAt?.[r.item.position] ?? null, r.item.status)),
          ),
      );
    }
    const queued = await pb.collection('import_jobs').update(job.id, { status: 'queued' });
    return { job: jobFromRecord(queued), playlistId: playlist?.id ?? null };
  } catch (e) {
    // Half an import is worse than none. A playlist import takes its job and
    // items with it through the cascade; a transfer has only the job.
    if (playlist) await pb.collection('playlists').delete(playlist.id).catch(() => {});
    else await pb.collection('import_jobs').delete(job.id).catch(() => {});
    throw e;
  }
}

/** The like date for every source position of a transfer: what the source
 *  says where it says anything, else one placed below the person's existing
 *  likes, in source order (lib/import/likedAt.ts). */
async function transferDates(pb: PocketBase, n: NewImport, total: number): Promise<Record<number, number>> {
  const given = new Map<number, number>();
  for (const item of n.items ?? []) if (typeof item.likedAt === 'number') given.set(item.position, item.likedAt);
  const out: Record<number, number> = {};
  if (given.size === total) {
    for (const [position, ms] of given) out[position] = ms;
    return out;
  }
  const base = transferBase(await oldestLikedAt(pb, n.userId), Date.now());
  for (let i = 0; i < total; i++) out[i] = given.get(i) ?? syntheticLikedAt(base, n.order ?? 'unknown', total, i);
  return out;
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
 *  position, or (for a transfer) like it. A re-pick swaps the old track out
 *  in place. */
export async function pickItem(pb: PocketBase, job: ImportJob, item: ImportItem, track: Track): Promise<void> {
  if (job.kind === 'liked') {
    const likeId = await pickLiked(pb, job, item, track);
    await saveResolvedItem(pb, job, item, track, likeId);
    return;
  }
  const { playlistId } = job;
  // A playlist import always has its playlist: createImportJob writes it
  // before the job, and deleting it takes the job with it.
  if (!playlistId) throw new Error('that import has no playlist');
  const oldVideo = item.videoId;
  const newTrackId = await upsertTrack(pb, track);
  let junction: { id: string } | null = null;
  if (oldVideo && oldVideo !== track.sourceId) {
    try {
      const oldTrack = await pb.collection('tracks').getFirstListItem(`external_id = "youtube:${esc(oldVideo)}"`);
      junction = await pb
        .collection('playlist_tracks')
        .getFirstListItem(`playlist = "${esc(playlistId)}" && track = "${oldTrack.id}"`);
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
    await addTrackAt(pb, playlistId, playlistPosition(item.position), track);
  }

  await saveResolvedItem(pb, job, item, track);
}

/** Like the picked song for a transfer. The wrong song is unliked first,
 *  but only the like this item made (`like_id`): it is only in the likes
 *  because Ember guessed it, so the person correcting the guess expects it
 *  gone. A like that was there before (made by hand or by another transfer),
 *  or an item saved before `like_id` existed, is left alone. While another
 *  song of this transfer still points at the same video, that song takes
 *  the like over instead. Returns the item's like from now on. */
async function pickLiked(pb: PocketBase, job: ImportJob, item: ImportItem, track: Track): Promise<string> {
  const oldVideo = item.videoId;
  const own = String((await pb.collection('import_items').getOne(item.id)).like_id ?? '');
  let kept = own;
  if (own && oldVideo && oldVideo !== track.sourceId) {
    kept = '';
    const sharing = (
      await pb.collection('import_items').getFullList({ filter: `job = "${esc(job.id)}" && video_id = "${esc(oldVideo)}"` })
    ).filter((r) => r.id !== item.id && (r.status === 'accepted' || r.status === 'resolved'));
    if (sharing.length) {
      await pb.collection('import_items').update(sharing[0].id, { like_id: own });
    } else {
      try {
        const like = await pb.collection('likes').getOne(own);
        if (like.origin === 'import') await pb.collection('likes').delete(own);
      } catch (e) {
        // Unliked by hand since.
        if (status(e) !== 404) throw e;
      }
    }
  }
  const liked = await likeTrack(pb, job.userId, track, item.likedAt);
  return liked.id ?? kept;
}

/** The item is settled: it points at the picked song, which joins the
 *  candidates when it came from a search so a later re-match still lists
 *  it, and the job's counts are recomputed. */
async function saveResolvedItem(
  pb: PocketBase,
  job: ImportJob,
  item: ImportItem,
  track: Track,
  likeId?: string,
): Promise<void> {
  const known = item.candidates.some((c) => c.track.sourceId === track.sourceId);
  await pb.collection('import_items').update(item.id, {
    status: 'resolved',
    video_id: track.sourceId,
    ...(likeId !== undefined ? { like_id: likeId } : {}),
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
