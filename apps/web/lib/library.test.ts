import { describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_VIEW_KEY,
  arrangeLibrary,
  badgeCoverLook,
  buildLibraryItems,
  firstArts,
  libraryChips,
  nextChip,
  readLibraryView,
  writeLibraryView,
  type LibraryItem,
} from './library';
import { toSummary } from './collections';

const songs = (...arts: (string | null)[]) => arts.map((artworkUrl) => ({ artworkUrl }));
const pl = (id: string, name: string, extra: Parameters<typeof toSummary>[1] = {}, pinned = false) => ({
  ...toSummary({ kind: 'playlist', id }, { name, ...extra }),
  pinned,
});

function build(over: Partial<Parameters<typeof buildLibraryItems>[0]> = {}) {
  return buildLibraryItems({
    liked: songs('l1', 'l2'),
    history: songs('h1', 'h2', 'h3', 'h4', 'h5'),
    uploads: songs(),
    playlists: [pl('p1', 'Zebra', { trackCount: 23 }), pl('p2', 'apple', { trackCount: 1 }), pl('p3', 'Mango')],
    downloadedIds: new Set(),
    ...over,
  });
}

describe('libraryChips / nextChip', () => {
  it('Playlists and Downloaded always; Mixes only when there are mixes', () => {
    expect(libraryChips(false).map((c) => c.label)).toEqual(['Playlists', 'Downloaded']);
    expect(libraryChips(true).map((c) => c.label)).toEqual(['Playlists', 'Mixes', 'Downloaded']);
  });

  it('tapping the active chip clears it, another chip replaces it', () => {
    expect(nextChip(null, 'playlists')).toBe('playlists');
    expect(nextChip('playlists', 'playlists')).toBeNull();
    expect(nextChip('playlists', 'downloaded')).toBe('downloaded');
  });
});

describe('buildLibraryItems', () => {
  it('system collections first (Liked, Recently played, Uploads), then playlists; no Downloaded row with nothing downloaded', () => {
    expect(build().map((i) => i.title)).toEqual(['Liked songs', 'Recently played', 'Uploads', 'Zebra', 'apple', 'Mango']);
  });

  it('subtitles: "Playlist · 23 songs", "Auto playlist · 5 songs", a shared playlist says whose', () => {
    const items = build({
      playlists: [
        pl('p1', 'Zebra', { trackCount: 23 }),
        pl('p2', 'Theirs', { trackCount: 4, sharing: { role: 'member', ownerName: 'Mia' } }),
        pl('p3', 'Unknown'),
      ],
    });
    const sub = (t: string) => items.find((i) => i.title === t)!.subtitle;
    expect(sub('Liked songs')).toBe('Playlist · 2 songs');
    expect(sub('Recently played')).toBe('Auto playlist · 5 songs');
    expect(sub('Uploads')).toBe('Uploads · 0 songs');
    expect(sub('Zebra')).toBe('Playlist · 23 songs');
    expect(sub('Theirs')).toBe('Playlist · Mia');
    expect(sub('Unknown')).toBe('Playlist');
  });

  it('adds a Downloaded row after Uploads when something is downloaded, counting it and borrowing its covers', () => {
    const items = build({
      downloadedIds: new Set(['liked', 'p1']),
      playlists: [pl('p1', 'Zebra', { trackCount: 23, downloaded: true, trackArtworks: ['a', 'b'] }), pl('p2', 'apple')],
    });
    expect(items.map((i) => i.kind)).toEqual(['liked', 'recent', 'uploads', 'downloaded', 'playlist', 'playlist']);
    const dl = items.find((i) => i.kind === 'downloaded')!;
    expect(dl.subtitle).toBe('2 playlists · 25 songs');
    expect(dl.href).toBeUndefined();
    expect(dl.cover).toEqual({ kind: 'badge', badge: 'downloaded', arts: ['l1', 'l2', 'a', 'b'] });
    expect(items.find((i) => i.kind === 'liked')!.downloaded).toBe(true);
  });

  it('covers: Liked keeps its own, Recently played and Uploads a badge with their song covers, playlists their art', () => {
    const items = build();
    expect(items[0].cover).toEqual({ kind: 'liked' });
    expect(items[1].cover).toEqual({ kind: 'badge', badge: 'recent', arts: ['h1', 'h2', 'h3', 'h4'] });
    expect(items[2].cover).toEqual({ kind: 'badge', badge: 'uploads', arts: [] });
    expect(items[3].cover).toEqual({ kind: 'art', src: null });
  });

  it('carries pinned and the playlist id through', () => {
    const items = build({ playlists: [pl('p9', 'Car', {}, true)] });
    expect(items.at(-1)).toMatchObject({ pinned: true, playlistId: 'p9', href: '/playlist/p9' });
  });
});

describe('arrangeLibrary', () => {
  const items = (): LibraryItem[] =>
    build({
      downloadedIds: new Set(['p3']),
      playlists: [pl('p1', 'Zebra'), pl('p2', 'apple'), pl('p3', 'Mango', { downloaded: true }, true)],
    });

  it('Recents keeps the given order after the system collections', () => {
    expect(arrangeLibrary(items()).map((i) => i.title)).toEqual([
      'Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Zebra', 'apple', 'Mango',
    ]);
  });

  it('Alphabetical sorts the playlists A to Z (case-blind), pinned ones still on top, system first', () => {
    expect(arrangeLibrary(items(), { sort: 'alpha' }).map((i) => i.title)).toEqual([
      'Liked songs', 'Recently played', 'Uploads', 'Downloaded', 'Mango', 'apple', 'Zebra',
    ]);
  });

  it('the Playlists chip shows only playlists', () => {
    expect(arrangeLibrary(items(), { chip: 'playlists' }).map((i) => i.kind)).toEqual(['playlist', 'playlist', 'playlist']);
  });

  it('the Downloaded chip shows what is downloaded, without the Downloaded row itself', () => {
    expect(arrangeLibrary(items(), { chip: 'downloaded' }).map((i) => i.title)).toEqual(['Mango']);
  });

  it('the Mixes chip shows only mixes', () => {
    expect(arrangeLibrary(items(), { chip: 'mixes' })).toEqual([]);
  });

  it('search narrows by name, case- and accent-blind, on top of the chip', () => {
    expect(arrangeLibrary(items(), { query: '  AN ' }).map((i) => i.title)).toEqual(['Mango']);
    expect(arrangeLibrary(items(), { query: 'liked' }).map((i) => i.title)).toEqual(['Liked songs']);
    const cafe = build({ playlists: [pl('c', 'Café')] });
    expect(arrangeLibrary(cafe, { query: 'cafe', chip: 'playlists' }).map((i) => i.title)).toEqual(['Café']);
    expect(arrangeLibrary(cafe, { query: 'liked', chip: 'playlists' })).toEqual([]);
  });
});

describe('badgeCoverLook / firstArts', () => {
  it('four or more distinct covers make a mosaic of the first four', () => {
    expect(badgeCoverLook(['a', 'a', 'b', null, 'c', 'd', 'e'])).toEqual({ mode: 'mosaic', tiles: ['a', 'b', 'c', 'd'] });
  });

  it('one to three show the first one full size', () => {
    expect(badgeCoverLook(['x', 'y'])).toEqual({ mode: 'single', src: 'x' });
  });

  it('none leaves the plain tile', () => {
    expect(badgeCoverLook([null, undefined, ''])).toEqual({ mode: 'plain' });
  });

  it('firstArts skips missing and repeated covers', () => {
    expect(firstArts(songs(null, 'a', 'a', 'b'))).toEqual(['a', 'b']);
  });
});

describe('the view choice', () => {
  it('reads list by default and grid once saved', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readLibraryView(storage)).toBe('list');
    writeLibraryView('grid', storage);
    expect(store.get(LIBRARY_VIEW_KEY)).toBe('grid');
    expect(readLibraryView(storage)).toBe('grid');
  });

  it('survives storage that throws', () => {
    const bad = { getItem: vi.fn(() => { throw new Error('blocked'); }), setItem: vi.fn(() => { throw new Error('blocked'); }) };
    expect(readLibraryView(bad)).toBe('list');
    expect(() => writeLibraryView('grid', bad)).not.toThrow();
  });
});
