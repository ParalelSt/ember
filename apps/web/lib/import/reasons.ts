/** How the review screens word a candidate: which of score()'s reasons
 *  count in its favour, its type badge, and the one line saying why a song
 *  needs a look. Pure: shared by the sheet and the playlist rows. */

import type { ImportCandidate, ImportItem } from '@/lib/import/types';
import { UPLOAD_REASON } from '@/lib/import/musicCheck';
import { READY_REASON } from '@/lib/import/sources/ytmusicLiked';

const GOOD = new Set([
  'Same title',
  'Similar title',
  'Same artist',
  'Similar artist name',
  'Length matches',
  'Length close',
  'Official audio',
  'From the playlist itself',
  READY_REASON,
]);

/** Reasons that only restate the type badge. */
const TYPE_REASONS = new Set(['Official audio', 'Music video', 'Fan upload']);

export function reasonIsGood(reason: string): boolean {
  return GOOD.has(reason);
}

export type CandidateKind = 'Official audio' | 'Music video' | 'Fan upload';

export function kindOf(videoType: string | null | undefined): CandidateKind | null {
  const t = (videoType ?? '').replace(/^MUSIC_VIDEO_TYPE_/, '').toUpperCase();
  if (t === 'ATV') return 'Official audio';
  if (t === 'OMV') return 'Music video';
  if (t === 'UGC') return 'Fan upload';
  return null;
}

/** The reasons to list under a candidate, with a good/bad mark each. The
 *  type reason is left out when the badge already says it. */
export function candidateReasons(c: ImportCandidate): { text: string; good: boolean }[] {
  const badge = kindOf(c.videoType);
  return c.reasons.filter((r) => !(badge && TYPE_REASONS.has(r))).map((text) => ({ text, good: reasonIsGood(text) }));
}

/** Two candidates this close are a coin toss. */
const TIED_WITHIN = 5;

/** One short line for the source card: why this song waits for a person. */
export function reviewFlag(item: ImportItem): string | null {
  if (item.status === 'missing') return 'Nothing on YouTube Music was close enough';
  if (item.status !== 'review') return null;
  const [best, second] = item.candidates;
  if (!best) return null;
  if (best.reasons.includes(UPLOAD_REASON)) return 'Is this a song? YouTube Music only knows it as an upload';
  if (second && best.score - second.score <= TIED_WITHIN) return 'Two versions are almost tied';
  const against = best.reasons.filter((r) => !reasonIsGood(r) && r !== 'Music video');
  if (!against.length) return 'Not sure enough to add it by itself';
  return `Best match: ${against.slice(0, 2).join(', ').toLowerCase()}`;
}
