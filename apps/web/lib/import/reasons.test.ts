import { describe, expect, it } from 'vitest';
import { candidateReasons, kindOf, reasonIsGood, reviewFlag } from '@/lib/import/reasons';
import type { ImportCandidate, ImportItem } from '@/lib/import/types';

const cand = (score: number, reasons: string[], videoType: string | null = 'ATV'): ImportCandidate => ({
  track: {
    id: 'youtube:x',
    source: 'youtube',
    sourceId: 'x',
    title: 't',
    artist: 'a',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 1,
    artworkUrl: null,
    streamUrl: '',
  },
  artists: ['a'],
  videoType,
  explicit: null,
  score,
  reasons,
});

const item = (status: ImportItem['status'], candidates: ImportCandidate[]): ImportItem => ({
  id: 'i',
  position: 0,
  status,
  source: { position: 0, title: 's', artists: [], artist: '', durationMs: null, explicit: null, uri: null },
  likedAt: null,
  videoId: null,
  confidence: candidates[0]?.score ?? null,
  candidates,
});

describe('import reasons', () => {
  it('tells points in favour from points against', () => {
    expect(['Same title', 'Same artist', 'Length matches', 'Official audio'].every(reasonIsGood)).toBe(true);
    expect(['Different artist', 'Live version', 'Fan upload', 'Length off by 40 s'].some(reasonIsGood)).toBe(false);
  });

  it('turns the video type into a badge', () => {
    expect(kindOf('ATV')).toBe('Official audio');
    expect(kindOf('MUSIC_VIDEO_TYPE_OMV')).toBe('Music video');
    expect(kindOf('UGC')).toBe('Fan upload');
    expect(kindOf(null)).toBeNull();
  });

  it('leaves out the reason the badge already says', () => {
    expect(candidateReasons(cand(90, ['Same title', 'Official audio', 'Live version']))).toEqual([
      { text: 'Same title', good: true },
      { text: 'Live version', good: false },
    ]);
    // No badge: the reason stays.
    expect(candidateReasons(cand(90, ['Official audio'], null))).toEqual([{ text: 'Official audio', good: true }]);
  });

  it('says why a song waits for a person', () => {
    expect(reviewFlag(item('missing', []))).toBe('Nothing on YouTube Music was close enough');
    expect(reviewFlag(item('review', [cand(66, []), cand(63, [])]))).toBe('Two versions are almost tied');
    expect(reviewFlag(item('review', [cand(55, ['Same title', 'Live version', 'Fan upload'])]))).toBe(
      'Best match: live version, fan upload',
    );
    expect(reviewFlag(item('accepted', [cand(90, [])]))).toBeNull();
  });
});
