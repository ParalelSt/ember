/** Is a liked video a song? The second of two passes over a person's Google
 *  likes, both done before the preview. The first (lib/import/google/
 *  likes.ts) keeps what the uploader filed under Music or a Topic channel
 *  posted, which drops most likes for free. That is only the uploader's
 *  word, though: a Minecraft video and a satire ad both said "Music" in the
 *  owner's real likes. So YouTube Music itself is asked about each survivor
 *  (`player.py classify`) while the dialog says "Checking which likes are
 *  songs", and its `musicVideoType` decides:
 *    ATV (official audio, a "Topic" channel, never asked about) and OMV
 *      (official music video) are songs, liked straight away;
 *    UGC (someone's upload) may or may not be one, so the person is asked in
 *      the review sheet, with the video itself as the one candidate;
 *    anything else (no type, unplayable, the lookup failed) is not music: it
 *      never shows in the preview or on the Liked page, and is only counted.
 *
 *  Pure apart from what it is handed, so the mapping, the batching and the
 *  owner's 16 likes are fixture tests. */

import type { ImportCandidate } from '@/lib/import/types';
import type { LikedSong } from '@/lib/import/sources/ytmusicLiked';
import { BACKOFF_MS, BATCH_SIZE } from '@/lib/import/jobState';

/** `import_jobs.source_id` of a transfer from a person's Google likes. */
export const GOOGLE_LIKES_SOURCE_ID = 'ytmusic-liked';

export type MusicVideoType = 'ATV' | 'OMV' | 'UGC';

export type LikeOutcome = 'accepted' | 'review' | 'skipped';

/** What `player.py classify` answered for one batch. */
export interface MusicCheck {
  types: Map<string, MusicVideoType | null>;
  /** Ids whose lookup failed: left out like the rest of the nulls, but
   *  logged. */
  failed: string[];
}

/** The reason the review sheet shows under an upload it asks about. */
export const UPLOAD_REASON = 'Uploaded by someone, not by YouTube Music';

export function musicVideoType(v: unknown): MusicVideoType | null {
  return v === 'ATV' || v === 'OMV' || v === 'UGC' ? v : null;
}

export function likeOutcome(type: MusicVideoType | null | undefined): LikeOutcome {
  if (type === 'ATV' || type === 'OMV') return 'accepted';
  if (type === 'UGC') return 'review';
  return 'skipped';
}

/** A like's one candidate once YouTube Music has said what it is: the type
 *  filled in, and an upload saying why it is being asked about. */
export function songCandidate(c: ImportCandidate, type: MusicVideoType | null): ImportCandidate {
  return {
    ...c,
    videoType: type,
    reasons: type === 'UGC' ? [...c.reasons.filter((r) => r !== UPLOAD_REASON), UPLOAD_REASON] : c.reasons,
  };
}

/** How many likes of a Google likes transfer were not music: every item it
 *  got through that did not become a song, need a check or go missing. That
 *  is the likes YouTube Music left out (created skipped, after the songs,
 *  so a finished job's cursor covers them) plus the uploads the person said
 *  no to, and both are "not music" to them. A transfer stopped early has
 *  not reached them, so it says little or nothing rather than guess. */
export function notMusicCount(j: { cursor: number; accepted: number; review: number; missing: number }): number {
  return Math.max(0, j.cursor - j.accepted - j.review - j.missing);
}

/** `player.py classify`'s output, as it comes off stdout. */
export interface RawMusicCheck {
  results?: Record<string, unknown>;
  failed?: unknown[];
  busy?: boolean;
}

/** YouTube Music asked Ember to slow down: the check backs off and repeats
 *  the batch, exactly as the runner does for a search. */
export class MusicCheckBusy extends Error {
  readonly status = 503;
  constructor() {
    super('YouTube Music asked Ember to slow down, try again shortly');
    this.name = 'MusicCheckBusy';
  }
}

/** The answer for exactly the ids asked about. An id the helper did not
 *  mention counts as failed (so left out and logged), and anything that is
 *  not one of the three types is null. */
export function parseMusicCheck(raw: RawMusicCheck | null | undefined, videoIds: string[]): MusicCheck {
  if (raw?.busy) throw new MusicCheckBusy();
  if (!raw || typeof raw.results !== 'object' || raw.results === null) {
    throw new Error('the music check returned no results');
  }
  const results = raw.results;
  const failed = new Set((raw.failed ?? []).filter((id): id is string => typeof id === 'string'));
  const types = new Map<string, MusicVideoType | null>();
  for (const id of videoIds) {
    if (!Object.prototype.hasOwnProperty.call(results, id)) failed.add(id);
    types.set(id, musicVideoType(results[id]));
  }
  return { types, failed: videoIds.filter((id) => failed.has(id)) };
}

/** YouTube Music kept saying no after every backoff: the check stops rather
 *  than call a song "not music" it never got an answer about. */
export class MusicCheckGaveUp extends Error {
  constructor() {
    super('YouTube Music is not answering the music check');
    this.name = 'MusicCheckGaveUp';
  }
}

/** Batches of 8 in flight at once. Three `player.py classify` processes,
 *  each one anonymous get_song after another: a few hundred likes take
 *  about a minute. */
export const CHECK_CONCURRENCY = 3;

export interface CheckLikesDeps {
  /** One `player.py classify` (lib/sources/youtube.ts classifyVideos). */
  classify: (videoIds: string[]) => Promise<MusicCheck>;
  sleep: (ms: number) => Promise<void>;
  /** False once the sign-in is cancelled or over: stop asking. */
  live: () => boolean;
  /** How many of the likes that need asking have been answered. */
  onProgress?: (done: number, total: number) => void;
  log?: (message: string, data?: Record<string, unknown>) => void;
  batchSize?: number;
  concurrency?: number;
  backoffMs?: readonly number[];
}

/** The second pass: every like with its YouTube Music type (null: not
 *  music), in the order given. Likes that already have a type (a Topic
 *  channel) are not asked about. A batch that fails as a whole (YouTube
 *  Music asking to slow down, the helper failing) waits 5 s, 20 s, 60 s and
 *  is asked again, then MusicCheckGaveUp; one video whose own lookup failed
 *  is only left out, with a warning. Null when `live` turned false. */
export async function checkLikes(songs: LikedSong[], deps: CheckLikesDeps): Promise<LikedSong[] | null> {
  const size = deps.batchSize ?? BATCH_SIZE;
  const backoff = deps.backoffMs ?? BACKOFF_MS;
  const ids = [...new Set(songs.filter((s) => !s.videoType).map((s) => s.track.sourceId))];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  const types = new Map<string, MusicVideoType | null>();
  let done = 0;
  let next = 0;
  deps.onProgress?.(0, ids.length);

  const ask = async (batch: string[]): Promise<MusicCheck | null> => {
    for (let failures = 0; ; ) {
      try {
        return await deps.classify(batch);
      } catch (e) {
        const wait = backoff[failures++];
        deps.log?.('music check batch failed', { failures, error: (e as Error).message });
        if (wait === undefined) throw new MusicCheckGaveUp();
        await deps.sleep(wait);
        if (!deps.live()) return null;
      }
    }
  };

  const worker = async () => {
    while (next < batches.length && deps.live()) {
      const batch = batches[next++];
      const check = await ask(batch);
      if (!check || !deps.live()) return;
      for (const id of batch) types.set(id, check.types.get(id) ?? null);
      for (const videoId of check.failed) deps.log?.('music check failed for a like, left out', { videoId });
      done += batch.length;
      deps.onProgress?.(done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? CHECK_CONCURRENCY, batches.length) }, worker));
  if (!deps.live()) return null;
  return songs.map((s) => (s.videoType ? s : { ...s, videoType: types.get(s.track.sourceId) ?? null }));
}
