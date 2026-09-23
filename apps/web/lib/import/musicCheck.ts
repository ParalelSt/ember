/** Is a liked video a song? Asked of YouTube Music itself during a Google
 *  likes transfer (`player.py classify`), because the category an uploader
 *  picks on YouTube is not: a Minecraft video and a satire ad both said
 *  "Music" in the owner's real likes.
 *
 *  YouTube Music's `musicVideoType` decides:
 *    ATV (official audio, a "Topic" channel) and OMV (official music video)
 *      are songs, liked straight away;
 *    UGC (someone's upload) may or may not be one, so the person is asked in
 *      the review sheet, with the video itself as the one candidate;
 *    anything else (no type, unplayable, the lookup failed) is left out and
 *      counted as not music.
 *
 *  Pure, so the mapping and the owner's 16 likes are fixture tests. */

import type { ImportCandidate } from '@/lib/import/types';

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

/** A ready candidate that still waits for YouTube Music's word. */
export function needsMusicCheck(candidates: ImportCandidate[]): boolean {
  return candidates.length === 1 && candidates[0].unchecked === true;
}

/** The candidate once YouTube Music has answered: its type filled in, the
 *  mark gone, and an upload saying why it is being asked about. */
export function checkedCandidate(c: ImportCandidate, type: MusicVideoType | null): ImportCandidate {
  const out: ImportCandidate = {
    ...c,
    videoType: type,
    reasons: type === 'UGC' ? [...c.reasons.filter((r) => r !== UPLOAD_REASON), UPLOAD_REASON] : c.reasons,
  };
  delete out.unchecked;
  return out;
}

/** How many likes of a finished (or stopped) Google likes transfer were not
 *  music: every like it got through that did not become a song, need a
 *  check or go missing. That is the ones YouTube Music left out plus the
 *  uploads the person said no to, and both are "not music" to them. */
export function notMusicCount(j: { cursor: number; accepted: number; review: number; missing: number }): number {
  return Math.max(0, j.cursor - j.accepted - j.review - j.missing);
}

/** `player.py classify`'s output, as it comes off stdout. */
export interface RawMusicCheck {
  results?: Record<string, unknown>;
  failed?: unknown[];
  busy?: boolean;
}

/** YouTube Music asked Ember to slow down: the runner backs off and repeats
 *  the batch, exactly as it does for a search. */
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
