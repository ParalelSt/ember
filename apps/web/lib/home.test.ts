import { describe, expect, it } from 'vitest';
import { QUICK_MAX, QUICK_MAX_DESKTOP, homeChips, phoneHomeView, quickPicks, recentFirst, rowEnds, rowStep, type HomeRowKey } from './home';
import { toSummary } from './collections';

const liked = toSummary({ kind: 'liked' }, { count: 3 });
const pl = (id: string, name: string, artworkUrl: string | null = null, trackArtworks?: string[]) =>
  toSummary({ kind: 'playlist', id }, { name, artworkUrl, trackArtworks });

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

  it('holds at most six tiles, three rows of two', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(`p${i}`, `P${i}`));
    const picks = quickPicks({ liked, playlists: many, carlist: null });
    expect(picks).toHaveLength(QUICK_MAX);
    expect(QUICK_MAX).toBe(6);
  });

  it('gives a playlist with four song covers a mosaic, fewer the first cover, none the gradient', () => {
    const arts = ['1', '2', '3', '4'].map((n) => `/art/${n}.jpg`);
    const picks = quickPicks({
      liked,
      playlists: [pl('a', 'Four', null, arts), pl('b', 'Two', null, arts.slice(0, 2)), pl('c', 'None'), pl('d', 'Mine', '/art/mine.jpg', arts)],
      carlist: null,
    });
    expect(picks[1]).toMatchObject({ src: null, mosaic: arts });
    expect(picks[2]).toMatchObject({ src: '/art/1.jpg' });
    expect(picks[2].mosaic).toBeUndefined();
    expect(picks[3]).toMatchObject({ src: null });
    expect(picks[3].mosaic).toBeUndefined();
    expect(picks[4]).toMatchObject({ src: '/art/mine.jpg' });
    expect(picks[4].mosaic).toBeUndefined();
    // Liked songs keeps its heart, never a mosaic.
    expect(picks[0]).toMatchObject({ icon: 'heart', src: null });
    expect(picks[0].mosaic).toBeUndefined();
  });

  it('brings the playing playlist into the grid even when it is old', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(`p${i}`, `P${i}`));
    const picks = quickPicks({ liked, playlists: many, carlist: null, playingPlaylistId: 'p11' });
    expect(picks[1].title).toBe('P11');
  });
});

describe('filter chips and order B', () => {
  const today = new Set<HomeRowKey>(['history', 'recommended', 'trending', 'playlists', 'friends']);

  it('shows only the chips with content today: All and Playlists', () => {
    expect(homeChips(today).map((c) => c.label)).toEqual(['All', 'Playlists']);
    expect(homeChips(new Set(['history'])).map((c) => c.label)).toEqual(['All']);
  });

  it('adds Mixes and Charts by themselves once those rows exist', () => {
    const later = new Set<HomeRowKey>([...today, 'mixes', 'charts']);
    expect(homeChips(later).map((c) => c.label)).toEqual(['All', 'Playlists', 'Mixes', 'Charts']);
  });

  it('All is order B: Recently played, Because you played, Popular now, Your playlists, Friends', () => {
    expect(phoneHomeView('all', today)).toEqual({
      filter: 'all',
      quickGrid: true,
      rows: ['history', 'recommended', 'trending', 'playlists', 'friends'],
    });
  });

  it('puts Your mixes right after the grid and Charts after Popular now once they exist', () => {
    const later = new Set<HomeRowKey>([...today, 'mixes', 'charts']);
    expect(phoneHomeView('all', later).rows).toEqual(['mixes', 'history', 'recommended', 'trending', 'charts', 'playlists', 'friends']);
  });

  it('Playlists keeps the quick grid and the playlist rows only', () => {
    expect(phoneHomeView('playlists', today)).toEqual({ filter: 'playlists', quickGrid: true, rows: ['playlists'] });
  });

  it('a filter whose chip is gone falls back to All', () => {
    expect(phoneHomeView('mixes', today).filter).toBe('all');
    expect(phoneHomeView('playlists', new Set(['history'])).rows).toEqual(['history']);
  });
});

describe('the desktop quick grid', () => {
  it('holds eight tiles, two rows of four, when asked', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(`p${i}`, `P${i}`));
    expect(QUICK_MAX_DESKTOP).toBe(8);
    expect(quickPicks({ liked, playlists: many, carlist: null, max: QUICK_MAX_DESKTOP })).toHaveLength(8);
  });

  it('knows the collection behind each tile so it can be played, but not a carlist', () => {
    const picks = quickPicks({
      liked,
      playlists: [pl('a', 'Road trip')],
      carlist: { id: 's1', code: 'ABC123', name: 'Friday drive', isHost: true },
    });
    expect(picks.map((p) => p.ref)).toEqual([{ kind: 'liked' }, undefined, { kind: 'playlist', id: 'a' }]);
  });
});

describe('the desktop row arrows', () => {
  it('offers only > at the start, both in the middle, only < at the end', () => {
    expect(rowEnds(0, 400, 1000)).toEqual({ canLeft: false, canRight: true });
    expect(rowEnds(300, 400, 1000)).toEqual({ canLeft: true, canRight: true });
    expect(rowEnds(600, 400, 1000)).toEqual({ canLeft: true, canRight: false });
    // A fraction of a pixel short of the end counts as the end.
    expect(rowEnds(599.5, 400, 1000).canRight).toBe(false);
  });

  it('offers neither when the row fits', () => {
    expect(rowEnds(0, 1000, 1000)).toEqual({ canLeft: false, canRight: false });
  });

  it('scrolls about 80% of the row width per press', () => {
    expect(rowStep(1000)).toBe(800);
    expect(rowStep(0)).toBe(1);
  });
});
