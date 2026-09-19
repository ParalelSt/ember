import { describe, expect, it } from 'vitest';
import {
  ACCEPT_AT,
  REVIEW_AT,
  normalizeTitle,
  rankCandidates,
  score,
  statusFor,
  type ScoreCandidate,
  type ScoreSource,
} from '@/lib/import/score';

const src = (
  title: string,
  artists: string[],
  durationMs: number | null = 200_000,
  explicit: boolean | null = false,
  artist?: string,
): ScoreSource => ({ title, artists, durationMs, explicit, artist });

const cand = (
  title: string,
  artists: string[],
  durationSec: number | null = 200,
  explicit: boolean | null = false,
  videoType: string | null = 'ATV',
): ScoreCandidate => ({ title, artists, durationSec, explicit, videoType });

// [name, source, candidate, expected score, expected status, reasons that must appear]
const TABLE: [string, ScoreSource, ScoreCandidate, number, 'accepted' | 'review' | 'missing', string[]][] = [
  ['exact match', src('Bass Persuades', ['Miley Cyrus'], 202_460), cand('Bass Persuades', ['Miley Cyrus'], 203), 100, 'accepted', ['Same title', 'Same artist', 'Length matches', 'Official audio']],
  ['feat. in the source title', src('Sweet Talk (feat. Ty Dolla $ign)', ['Kali', 'Ty Dolla $ign']), cand('Sweet Talk', ['Kali']), 100, 'accepted', ['Same title', 'Same artist']],
  ['ft. in the candidate title', src('Sweet Talk', ['Kali']), cand('Sweet Talk ft. Ty Dolla $ign', ['Kali', 'Ty Dolla $ign']), 100, 'accepted', ['Same title']],
  ['remix offered for the original', src('Bass Persuades', ['Miley Cyrus'], 202_460), cand('Bass Persuades Remixx', ['Miley Cyrus'], 217), 55, 'review', ['Remix']],
  ['original offered for a remix', src('Levitating (feat. DaBaby) - Remix', ['Dua Lipa', 'DaBaby'], 203_000), cand('Levitating', ['Dua Lipa'], 204), 70, 'review', ['Not the remix']],
  ['live version', src('Yellow', ['Coldplay'], 266_773), cand('Yellow (Live in Buenos Aires)', ['Coldplay'], 290), 35, 'missing', ['Live version', 'Length off by 23 s']],
  ['clean offered for explicit', src('HUMBLE.', ['Kendrick Lamar'], 177_000, true), cand('HUMBLE.', ['Kendrick Lamar'], 177, false), 85, 'accepted', ['Clean version']],
  ['explicit offered for clean', src('HUMBLE.', ['Kendrick Lamar'], 177_000, false), cand('HUMBLE.', ['Kendrick Lamar'], 177, true), 85, 'accepted', ['Explicit version']],
  ['explicit on both sides', src('HUMBLE.', ['Kendrick Lamar'], 177_000, true), cand('HUMBLE.', ['Kendrick Lamar'], 177, true), 100, 'accepted', []],
  ['length off by 2 s', src('Song A', ['Band']), cand('Song A', ['Band'], 202), 100, 'accepted', ['Length matches']],
  ['length off by 5 s', src('Song A', ['Band']), cand('Song A', ['Band'], 205), 93, 'accepted', ['Length close']],
  ['length off by 40 s', src('Song A', ['Band']), cand('Song A', ['Band'], 240), 65, 'review', ['Length off by 40 s']],
  ['Topic channel (official audio)', src('Song A', ['Band']), cand('Song A', ['Band - Topic'], 200, false, 'MUSIC_VIDEO_TYPE_ATV'), 100, 'accepted', ['Official audio']],
  ['fan upload by the artist name', src('Song A', ['Band']), cand('Song A', ['Band'], 200, null, 'UGC'), 80, 'accepted', ['Fan upload']],
  ['fan upload by someone else', src('Song A', ['Band']), cand('Song A (Lyrics)', ['lyricsfan99'], 200, null, 'UGC'), 50, 'review', ['Different artist', 'Fan upload']],
  ['music video', src('Song A', ['Band']), cand('Song A (Official Music Video)', ['Band'], 212, null, 'OMV'), 75, 'accepted', ['Music video', 'Length off by 12 s']],
  ['another song by the artist', src('Bass Persuades', ['Miley Cyrus'], 202_460), cand('REDLIGHTS', ['Miley Cyrus'], 223), 20, 'missing', ['Different title']],
  ['accents and case', src('Café Del Mar', ['Energy 52']), cand('Cafe del Mar', ['Energy 52']), 100, 'accepted', ['Same title']],
  ['Remastered 2009', src('Here Comes The Sun - Remastered 2009', ['The Beatles'], 185_000), cand('Here Comes The Sun', ['The Beatles'], 186), 100, 'accepted', ['Same title']],
  ['a band with a comma in its name', src('September', ['Earth', 'Wind & Fire'], 200_000, false, 'Earth, Wind & Fire'), cand('September', ['Earth, Wind & Fire']), 100, 'accepted', ['Same artist']],
  ['artist name contained', src('Song A', ['Noah']), cand('Song A', ['Noah Official']), 85, 'accepted', ['Similar artist name']],
  ['acoustic version', src('Song A', ['Band']), cand('Song A (Acoustic)', ['Band'], 190), 55, 'review', ['Acoustic version']],
  ['karaoke upload', src('Song A', ['Band']), cand('Song A (Karaoke Version)', ['Karaoke Hits'], 200, null, 'UGC'), 20, 'missing', ['Karaoke version', 'Different artist']],
  ['sped up', src('Song A', ['Band']), cand('Song A (Sped Up)', ['Band'], 160), 35, 'missing', ['Sped up version']],
  ['apostrophe and a bracketed extra', src("Summer Of '69", ['Bryan Adams'], 216_000), cand('Summer of 69 (Classic Version)', ['Bryan Adams'], 249), 61, 'review', ['Similar title', 'Length off by 33 s']],
  ['candidate with no artist data', src("Livin' On A Prayer", ['Bon Jovi'], 249_000), cand("Livin' On A Prayer", [], 249, null, null), 60, 'review', ['Same title', 'Length matches']],
  ['no length, explicit or type data', src('Song A', ['Band'], null, null), cand('Song A', ['Band'], null, null, null), 75, 'accepted', []],
];

describe('score() fixture table', () => {
  it.each(TABLE)('%s', (_name, s, c, expected, status, reasons) => {
    const r = score(s, c);
    expect(r.score).toBe(expected);
    expect(statusFor(r.score)).toBe(status);
    for (const reason of reasons) expect(r.reasons).toContain(reason);
  });

  it('keeps every score between 0 and 100', () => {
    const worst = score(src('Song A', ['Band'], 200_000, true), cand('Completely Else (Live Karaoke)', ['Other'], 400, false, 'UGC'));
    expect(worst.score).toBe(0);
  });
});

describe('reasons text', () => {
  it('is short plain words, no scores or jargon', () => {
    for (const [, s, c] of TABLE) {
      for (const reason of score(s, c).reasons) {
        expect(reason).toMatch(/^[A-Z][a-z0-9 ]+$/);
        expect(reason.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it('says why a variant does not fit, from either side', () => {
    expect(score(src('Yellow', ['Coldplay']), cand('Yellow - Live', ['Coldplay'])).reasons).toContain('Live version');
    expect(score(src('Yellow - Live', ['Coldplay']), cand('Yellow', ['Coldplay'])).reasons).toContain('Not the live version');
    expect(score(src('Song', ['A']), cand('Song (Instrumental)', ['A'])).reasons).toContain('Instrumental');
    expect(score(src('Song', ['A']), cand('Song (Nightcore)', ['A'])).reasons).toContain('Nightcore version');
    expect(score(src('Song', ['A']), cand('Song (Cover)', ['A'])).reasons).toContain('Cover');
  });

  it('writes long length gaps in minutes', () => {
    expect(score(src('Song', ['A'], 200_000), cand('Song', ['A'], 290)).reasons).toContain('Length off by 1 min 30 s');
  });

  it('leaves a word that is on both sides alone', () => {
    const r = score(src('Live Forever', ['Oasis']), cand('Live Forever', ['Oasis']));
    expect(r.score).toBe(100);
  });
});

describe('thresholds', () => {
  it('75 and up is accepted, 50 to 74 review, under 50 not found', () => {
    expect(ACCEPT_AT).toBe(75);
    expect(REVIEW_AT).toBe(50);
    expect(statusFor(100)).toBe('accepted');
    expect(statusFor(75)).toBe('accepted');
    expect(statusFor(74)).toBe('review');
    expect(statusFor(50)).toBe('review');
    expect(statusFor(49)).toBe('missing');
    expect(statusFor(0)).toBe('missing');
  });

  it('no candidates at all is not found', () => {
    expect(statusFor(null)).toBe('missing');
    expect(statusFor(undefined)).toBe('missing');
  });
});

describe('rankCandidates', () => {
  it('puts the best fit first and keeps every candidate with its reasons', () => {
    const s = src('HUMBLE.', ['Kendrick Lamar'], 177_000, true);
    const ranked = rankCandidates(s, [
      { ...cand('HUMBLE. (Live)', ['Kendrick Lamar'], 190, true), id: 'live' },
      { ...cand('HUMBLE.', ['Kendrick Lamar'], 177, false), id: 'clean' },
      { ...cand('HUMBLE.', ['Kendrick Lamar'], 177, true), id: 'explicit' },
      { ...cand('HUMBLE.', ['kendrick fan'], 177, null, 'UGC'), id: 'ugc' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['explicit', 'clean', 'live', 'ugc']);
    expect(ranked).toHaveLength(4);
    expect(ranked[0].score).toBe(100);
    expect(ranked.every((r) => r.reasons.length > 0)).toBe(true);
  });

  it('keeps search order on a tie', () => {
    const ranked = rankCandidates(src('Song', ['A']), [
      { ...cand('Song', ['A']), id: 'first' },
      { ...cand('Song', ['A']), id: 'second' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['first', 'second']);
  });
});

describe('normalizeTitle', () => {
  it.each([
    ['Song (feat. Someone)', 'song'],
    ['Song [ft. Someone]', 'song'],
    ['Song (with Someone)', 'song'],
    ['Song feat. Someone', 'song'],
    ['Song (Official Audio)', 'song'],
    ['Song (Official Music Video)', 'song'],
    ['Song - Remastered 2011', 'song'],
    ['Song (2011 Remaster)', 'song'],
    ['Crème Brûlée', 'creme brulee'],
    ['Don’t Stop', "don't stop"],
    ['Song (Live)', 'song (live)'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeTitle(input)).toBe(out);
  });
});
