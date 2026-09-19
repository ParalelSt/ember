import 'server-only';
import { searchMatchCandidates, type RawMatchCandidate } from '@/lib/sources/youtube';
import { rankCandidates, statusFor, REVIEW_AT, type ScoreSource } from '@/lib/import/score';
import type { ImportCandidate, MatchResult, SourceItem } from '@/lib/import/types';

function sourceOf(item: SourceItem): ScoreSource {
  return {
    title: item.title,
    artists: item.artists,
    artist: item.artist,
    durationMs: item.durationMs,
    explicit: item.explicit,
  };
}

function build(item: SourceItem, raw: RawMatchCandidate[]): MatchResult {
  const ranked = rankCandidates(
    sourceOf(item),
    raw.map((c) => ({ ...c, title: c.track.title, durationSec: c.track.durationSec })),
  );
  const candidates: ImportCandidate[] = ranked.map((c) => ({
    track: c.track,
    artists: c.artists,
    videoType: c.videoType,
    explicit: c.explicit,
    score: c.score,
    reasons: c.reasons,
  }));
  const confidence = candidates[0]?.score ?? null;
  return { item, status: statusFor(confidence), confidence, candidates };
}

/** Match source tracks onto YouTube Music (8 or fewer per call).
 *
 *  First search: "title artist". Any item whose best candidate scores under
 *  50 gets a second search on the title alone with ignore_spelling; the two
 *  candidate lists merge (by video id) and are scored together. Nothing is
 *  guessed: the status says whether the best one is good enough. */
export async function matchItems(items: SourceItem[]): Promise<MatchResult[]> {
  const queries = items.map((i) => ({ title: i.title, artist: i.artist || i.artists.join(' ') }));
  const first = await searchMatchCandidates(queries);
  const results = items.map((item, i) => build(item, first[i] ?? []));

  const retry = results.flatMap((r, i) => ((r.confidence ?? 0) < REVIEW_AT ? [i] : []));
  if (retry.length) {
    const second = await searchMatchCandidates(
      retry.map((i) => queries[i]),
      { titleOnly: true },
    ).catch(() => null);
    if (second) {
      retry.forEach((idx, k) => {
        const seen = new Set((first[idx] ?? []).map((c) => c.track.sourceId));
        const merged = [...(first[idx] ?? []), ...(second[k] ?? []).filter((c) => !seen.has(c.track.sourceId))];
        results[idx] = build(items[idx], merged);
      });
    }
  }
  return results;
}
