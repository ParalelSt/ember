import { describe, expect, it } from 'vitest';
import { HISTORY_MIN_SIZE, HISTORY_MIX_SIZE, HISTORY_PER_ARTIST_MAX, onRepeatMix, songHistory, throwbackMix } from './history';
import { tt } from '@/test-utils/mixTracks';
import type { Track } from '@/types/track';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const DAY = 86400000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const played = (t: Track, ...daysAgo: number[]) => daysAgo.map((d) => ({ track: t, playedAt: at(d) }));
const songs = (artist: string, count: number) => Array.from({ length: count }, (_, i) => tt(`${artist.replace(/\W/g, '')}${i}`, artist));

describe('songHistory', () => {
  it('counts plays this month, since the gap and before it; likes; the last version played', () => {
    const t = tt('a1', 'A');
    const lyric = { ...tt('a1lyric', 'A', t.title) };
    const h = songHistory([...played(t, 1, 20, 45, 70, 200, 400), ...played(lyric, 0.5)], [t], NOW);
    const e = [...h.values()][0];
    expect(h.size).toBe(1);
    expect(e).toMatchObject({ recent: 3, sinceGap: 4, before: 2, total: 6, liked: true });
    expect(e.track.id).toBe(lyric.id);
  });
});

describe('onRepeatMix', () => {
  it('is the songs played twice or more this month, most played first', () => {
    const a = songs('Alpha', 6);
    const b = songs('Beta', 6);
    const plays = [
      ...a.flatMap((t, i) => played(t, ...Array.from({ length: 2 + i }, (_, k) => k + 1))),
      ...b.flatMap((t) => played(t, 2, 3)),
      ...played(tt('once', 'Gamma'), 1),
      ...played(tt('old', 'Delta'), 40, 41, 42),
    ];
    const mix = onRepeatMix(songHistory(plays, [], NOW))!;
    expect(mix.tracks).toHaveLength(HISTORY_PER_ARTIST_MAX * 2);
    expect(mix.tracks[0].id).toBe(a[5].id);
    expect(mix.tracks.some((t) => t.artist === 'Gamma' || t.artist === 'Delta')).toBe(false);
  });

  it('caps each artist, skips dead and blocked songs, and needs HISTORY_MIN_SIZE songs', () => {
    const many = [...songs('Solo', 12), ...songs('Duo', 6)];
    const h = songHistory(many.flatMap((t) => played(t, 1, 2)), [], NOW);
    const mix = onRepeatMix(h)!;
    expect(mix.tracks.filter((t) => t.artist === 'Solo')).toHaveLength(HISTORY_PER_ARTIST_MAX);
    expect(mix.tracks.length).toBe(HISTORY_MIN_SIZE);
    // One dead and one blocked Duo song leave nine: no mix.
    const dead = new Set([many[12].id]);
    const blocked = (t: Track) => t.id === many[13].id;
    expect(onRepeatMix(h, dead)).not.toBeNull();
    expect(onRepeatMix(h, dead, blocked)).toBeNull();
  });

  it('stops at HISTORY_MIX_SIZE', () => {
    const lots = Array.from({ length: 20 }, (_, i) => songs(`Band${i}`, 3)).flat();
    expect(onRepeatMix(songHistory(lots.flatMap((t) => played(t, 1, 2)), [], NOW))!.tracks).toHaveLength(HISTORY_MIX_SIZE);
  });
});

describe('throwbackMix', () => {
  it('is the songs played a lot before and not in the last 60 days', () => {
    const old = [...songs('Old', 5), ...songs('Older', 5)];
    const fresh = songs('Fresh', 3);
    const plays = [
      ...old.flatMap((t) => played(t, 90, 100, 120)),
      // Played a lot before, but also last week: not a throwback.
      ...fresh.flatMap((t) => played(t, 90, 100, 120, 7)),
    ];
    const mix = throwbackMix(songHistory(plays, [], NOW))!;
    expect(mix.tracks).toHaveLength(10);
    expect(mix.tracks.some((t) => t.artist === 'Fresh')).toBe(false);
  });

  it('a liked song needs only one play before the gap; a like counts two plays', () => {
    const old = songs('Old', 5).concat(songs('Older', 4));
    const liked = tt('liked', 'Fav');
    const plays = [...old.flatMap((t) => played(t, 90, 100, 120)), ...played(liked, 200, 210)];
    const mix = throwbackMix(songHistory(plays, [liked], NOW))!;
    expect(mix.tracks).toHaveLength(10);
    expect(mix.tracks[0].id).toBe(liked.id);
    // Liked but never played before the gap is not a throwback.
    const never = tt('never', 'New');
    expect(throwbackMix(songHistory(plays, [liked, never], NOW))!.tracks.some((t) => t.id === never.id)).toBe(false);
    // Too few: no mix.
    expect(throwbackMix(songHistory(old.slice(0, 5).flatMap((t) => played(t, 90, 100, 120)), [], NOW))).toBeNull();
  });
});
