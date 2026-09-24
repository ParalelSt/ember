/** A stand-in for `player.py classify`, one level below classifyVideos: it
 *  answers with the raw JSON the helper prints (results, failed, busy) and
 *  runs it through the same parseMusicCheck, so a test sees exactly what the
 *  real path would. Every batch asked about is recorded, with how many were
 *  in flight at once. Plus the owner's 16 real likes (tests/fixtures/
 *  imports/ytm-get-song-liked16.json) as the YouTube Data API hands them
 *  over. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMusicCheck, type MusicCheck, type RawMusicCheck } from '@/lib/import/musicCheck';
import type { YoutubeVideo } from '@/lib/import/google/likes';

/** What YouTube Music says per video id: a type, null (not music), "fail"
 *  (the lookup raised), "busy" (asked to slow down). */
export type FakeAnswer = 'ATV' | 'OMV' | 'UGC' | null | 'fail' | 'busy';

export interface FakeYoutubeMusicOptions {
  /** Hold every batch until the test lets it go. */
  gated?: boolean;
}

export function fakeYoutubeMusic(answers: Record<string, FakeAnswer | FakeAnswer[]>, opts: FakeYoutubeMusicOptions = {}) {
  const asked: string[][] = [];
  const waiting: (() => void)[] = [];
  const seen = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;

  /** The next answer for an id: a list is used up one call at a time, the
   *  last one repeating. An id not listed has no type. */
  const answer = (id: string): FakeAnswer => {
    const a = answers[id];
    if (!Array.isArray(a)) return a ?? null;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return a[Math.min(n, a.length - 1)];
  };

  const classify = async (ids: string[]): Promise<MusicCheck> => {
    asked.push([...ids]);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (opts.gated) await new Promise<void>((r) => waiting.push(r));
      const raw: RawMusicCheck = { results: {}, failed: [], busy: false };
      for (const id of ids) {
        const a = answer(id);
        if (a === 'busy') {
          raw.busy = true;
          break;
        }
        raw.results![id] = a === 'fail' ? null : a;
        if (a === 'fail') raw.failed!.push(id);
      }
      return parseMusicCheck(raw, ids);
    } finally {
      inFlight -= 1;
    }
  };

  return {
    classify,
    asked,
    get maxInFlight() {
      return maxInFlight;
    },
    /** Batches held by `gated`, waiting to be let go. */
    get waiting() {
      return waiting.length;
    },
    /** Let the oldest held batch answer. */
    release() {
      waiting.shift()?.();
    },
  };
}

interface Liked16Row {
  videoId: string;
  title: string;
  channel: string;
  musicVideoType: string | null;
}

/** The owner's 16 likes, recorded from their real transfer. All 16 came back
 *  from Google filed under Music (category 10), which is why the first pass
 *  alone let a Minecraft video through. */
export function liked16(): { videos: YoutubeVideo[]; answers: Record<string, FakeAnswer>; rows: Liked16Row[] } {
  const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'imports', 'ytm-get-song-liked16.json');
  const rows = (JSON.parse(readFileSync(path, 'utf8')) as { songs: Liked16Row[] }).songs;
  return {
    rows,
    videos: rows.map((r) => ({
      id: r.videoId,
      snippet: { title: r.title, channelTitle: r.channel, categoryId: '10' },
      contentDetails: { duration: 'PT3M' },
    })),
    // player.py's own mapping: MUSIC_VIDEO_TYPE_ATV to ATV, and so on.
    answers: Object.fromEntries(
      rows.map((r) => [r.videoId, ((r.musicVideoType ?? '').replace('MUSIC_VIDEO_TYPE_', '') || null) as FakeAnswer]),
    ),
  };
}

/** The titles of the owner's likes, by what YouTube Music said they are. */
export const LIKED16_SONGS = ['Ashes of the Dawn', 'Kradem Bakar', 'Uzalud Sunce Sja', 'Voices', 'ZITTI E BUONI'];
export const LIKED16_UPLOADS = [
  'Ali-A intro song',
  'Batzorig Vaanchig- Mongolian Throat Singing',
  'Chopin - Etude Op. 25 No. 11 (Winter Wind)',
  'NEW Bricks and Minifigs Commercial (satire)',
  'Welcome to American Fork!',
];
export const LIKED16_NOT_MUSIC = [
  'Eminem on TV Was Actually Insane',
  'How long it takes to learn drums #drums #drummers',
  'I Built a GIANT Mob Farm in Old Minecraft',
  "[YTP] dexter can't open the cargo box",
  "if you're reading this, i'm in prison...",
  'ты слышал это в играх про гонки',
];
