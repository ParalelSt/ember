import { describe, expect, it } from 'vitest';
import { QUICK_MAX, quickPicks, recentFirst } from './home';
import { toSummary } from './collections';

const liked = toSummary({ kind: 'liked' }, { count: 3 });
const pl = (id: string, name: string, artworkUrl: string | null = null) =>
  toSummary({ kind: 'playlist', id }, { name, artworkUrl });

describe('recentFirst', () => {
  const list = [pl('a', 'A'), pl('b', 'B'), pl('c', 'C')];

  it('keeps the server order (newest first) when nothing is playing', () => {
    expect(recentFirst(list, null).map((p) => p.title)).toEqual(['A', 'B', 'C']);
  });

  it('moves the playlist that is playing to the front', () => {
    expect(recentFirst(list, 'c').map((p) => p.title)).toEqual(['C', 'A', 'B']);
  });

  it('ignores a playing id that is not one of yours', () => {
    expect(recentFirst(list, 'zzz').map((p) => p.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('quickPicks', () => {
  it('starts with Liked songs, then your playlists with their covers', () => {
    const picks = quickPicks({ liked, playlists: [pl('a', 'Road trip', '/art/a.jpg'), pl('b', 'Gym')], carlist: null });
    expect(picks.map((p) => p.title)).toEqual(['Liked songs', 'Road trip', 'Gym']);
    expect(picks[0]).toMatchObject({ href: '/library/liked', icon: 'heart', src: null });
    expect(picks[1]).toMatchObject({ href: '/playlist/a', icon: null, src: '/art/a.jpg' });
  });

  it('puts a live carlist right after Liked songs, opening its session', () => {
    const picks = quickPicks({
      liked,
      playlists: [pl('a', 'Road trip')],
      carlist: { id: 's1', code: 'ABC123', name: 'Friday drive', isHost: true },
    });
    expect(picks.map((p) => p.title)).toEqual(['Liked songs', 'Friday drive', 'Road trip']);
    expect(picks[1]).toMatchObject({ href: '/session/s1', icon: 'car' });
  });

  it('holds at most eight tiles', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(`p${i}`, `P${i}`));
    const picks = quickPicks({ liked, playlists: many, carlist: null });
    expect(picks).toHaveLength(QUICK_MAX);
    expect(QUICK_MAX).toBe(8);
  });

  it('brings the playing playlist into the grid even when it is old', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(`p${i}`, `P${i}`));
    const picks = quickPicks({ liked, playlists: many, carlist: null, playingPlaylistId: 'p11' });
    expect(picks[1].title).toBe('P11');
  });
});
