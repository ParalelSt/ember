import { describe, expect, it } from 'vitest';
import { applyNavPatch, MAX_OPENED, orderNavPlaylists, parseNavPatch, readNavPrefs } from './navPlaylists';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const list = (...names: string[]) => names.map((id) => ({ id }));

describe('orderNavPlaylists', () => {
  it('keeps the library order when nothing was pinned or opened', () => {
    expect(ids(orderNavPlaylists(list('a', 'b', 'c'), { pinned: [], opened: {} }))).toEqual(['a', 'b', 'c']);
  });

  it('puts pinned first (newest pin on top), then the rest by recency', () => {
    const out = orderNavPlaylists(list('a', 'b', 'c', 'd', 'e'), { pinned: ['d', 'b'], opened: { a: 5, c: 9, b: 100 } });
    expect(ids(out)).toEqual(['d', 'b', 'c', 'a', 'e']);
    expect(out.map((x) => x.pinned)).toEqual([true, true, false, false, false]);
  });

  it('opening a playlist moves it up; never-opened ones and ties keep library order', () => {
    const out = orderNavPlaylists(list('a', 'b', 'c', 'd'), { pinned: [], opened: { c: 50, b: 50 } });
    expect(ids(out)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ignores pins and opens for playlists that no longer exist', () => {
    expect(ids(orderNavPlaylists(list('a', 'b'), { pinned: ['gone'], opened: { gone: 9 } }))).toEqual(['a', 'b']);
  });
});

describe('applyNavPatch', () => {
  const base = { pinned: ['a'], opened: { a: 1 } };
  it('pins to the front, unpins, and does not duplicate', () => {
    expect(applyNavPatch(base, { pin: 'b', pinned: true }, 0).pinned).toEqual(['b', 'a']);
    expect(applyNavPatch(base, { pin: 'a', pinned: true }, 0).pinned).toEqual(['a']);
    expect(applyNavPatch(base, { pin: 'a', pinned: false }, 0).pinned).toEqual([]);
  });
  it('stamps opened with the given time', () => {
    expect(applyNavPatch(base, { opened: 'z' }, 77).opened).toEqual({ a: 1, z: 77 });
  });
  it('caps the opened map, dropping the oldest', () => {
    const opened: Record<string, number> = {};
    for (let i = 1; i <= MAX_OPENED; i++) opened[`p${i}`] = i;
    const out = applyNavPatch({ pinned: [], opened }, { opened: 'new' }, 9999).opened;
    expect(Object.keys(out)).toHaveLength(MAX_OPENED);
    expect(out.p1).toBeUndefined();
    expect(out.new).toBe(9999);
  });
});

describe('readNavPrefs / parseNavPatch', () => {
  it('reads junk as empty and keeps only valid entries', () => {
    expect(readNavPrefs(null)).toEqual({ pinned: [], opened: {} });
    expect(readNavPrefs({ pinned: ['a', 'a', 5, 'bad id!'], opened: { a: 3, b: 'x', c: -1 } })).toEqual({ pinned: ['a'], opened: { a: 3 } });
  });
  it('accepts only a pin or an opened patch', () => {
    expect(parseNavPatch({ pin: 'a', pinned: true })).toEqual({ pin: 'a', pinned: true });
    expect(parseNavPatch({ opened: 'a' })).toEqual({ opened: 'a' });
    for (const bad of [null, [], {}, { pin: 'a' }, { pin: 'a', pinned: 'yes' }, { opened: 5 }, { opened: 'a', pin: 'b' }, { pin: '../x', pinned: true }]) {
      expect(parseNavPatch(bad)).toBeNull();
    }
  });
});
