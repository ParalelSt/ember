import { describe, expect, it } from 'vitest';
import { artistMixKey, artistTint, KIND_CAPS, KIND_LABEL, kindLook, lineup, MAX_MIXES, mixFullTitle, mixKind, mixPosition, refreshNote } from './kinds';
import { MIX_KEY_RE } from '../mixesView';
import { FAMILIES } from '../genres/taxonomy';

const n = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe('mix kinds', () => {
  it('reads the kind from the key', () => {
    expect(mixKind('rock-metal')).toBe('style');
    expect(mixKind('turbofolk')).toBe('style');
    expect(mixKind('artist-gojira')).toBe('artist');
    expect(mixKind('discover')).toBe('discover');
    expect(mixKind('on-repeat')).toBe('on-repeat');
    expect(mixKind('throwback')).toBe('throwback');
  });

  it('labels each kind for the card and names the mix', () => {
    expect(Object.values(KIND_LABEL)).toEqual(['MIX', 'DISCOVER', 'ON REPEAT', 'ARTIST MIX', 'THROWBACK']);
    expect(mixFullTitle('rock', 'Rock')).toBe('Rock Mix');
    expect(mixFullTitle('artist-gojira', 'Gojira')).toBe('Gojira Mix');
    expect(mixFullTitle('discover', 'New to you')).toBe('New to you');
    expect(mixFullTitle('throwback', 'Back again')).toBe('Back again');
    expect(refreshNote('discover')).toBe('New every Monday');
    expect(refreshNote('rock')).toBe('Rebuilt every night');
  });

  it('gives every kind a colour: genre tint, stored artist tint, fixed tints', () => {
    expect(kindLook('rock-metal').color).toBe(FAMILIES[0].tint);
    expect(kindLook('artist-gojira', '#123456').color).toBe('#123456');
    expect(kindLook('artist-gojira').color).toBe(artistTint('artist-gojira', null));
    const fixed = new Set(['discover', 'on-repeat', 'throwback'].map((k) => kindLook(k).color));
    expect(fixed.size).toBe(3);
    for (const k of ['discover', 'on-repeat', 'throwback', 'artist-x', 'pop']) expect(kindLook(k).ink).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('artist keys are URL-safe, fit the key limit and fold accents', () => {
    expect(artistMixKey('Gojira')).toBe('artist-gojira');
    expect(artistMixKey('Đorđe Balašević')).toBe('artist-dorde-balasevic');
    expect(artistMixKey('Beyoncé feat. Jay-Z')).toBe('artist-beyonce');
    expect(artistMixKey('Ceca - Topic')).toBe('artist-ceca');
    const cyr = artistMixKey('Цеца');
    expect(cyr).toMatch(/^artist-[a-z0-9]+$/);
    expect(artistMixKey('Цеца')).toBe(cyr);
    expect(artistMixKey('Цеца')).not.toBe(artistMixKey('Мирослав'));
    const long = artistMixKey('The Very Long Name Of A Band That Goes On And On Forever');
    expect(long.length).toBeLessThanOrEqual(40);
    for (const k of [long, cyr, artistMixKey('AC/DC'), artistMixKey('!!!')]) expect(k).toMatch(MIX_KEY_RE);
  });

  it('bands positions by kind', () => {
    expect([mixPosition('style', 0), mixPosition('style', 6), mixPosition('discover', 0), mixPosition('on-repeat', 0), mixPosition('artist', 5), mixPosition('throwback', 0)])
      .toEqual([0, 6, 10, 20, 35, 40]);
  });
});

describe('lineup', () => {
  it('with plenty of everything: five styles, Discover, On repeat, four artists, Throwback', () => {
    const got = lineup({ style: n('s', 9), discover: ['d'], 'on-repeat': ['r'], artist: n('a', 9), throwback: ['t'] });
    expect(got).toHaveLength(MAX_MIXES);
    expect(got.map((g) => g.item)).toEqual(['s0', 's1', 's2', 's3', 's4', 'd', 'r', 'a0', 'a1', 'a2', 'a3', 't']);
    expect(got.map((g) => g.index)).toEqual([0, 1, 2, 3, 4, 0, 0, 0, 1, 2, 3, 0]);
  });

  it('free slots go to more styles first, then more artists, never past their max', () => {
    // No Throwback, no On repeat: two free slots, both to style (up to 7).
    expect(lineup({ style: n('s', 9), discover: ['d'], artist: n('a', 9) }).map((g) => g.kind).filter((k) => k === 'style')).toHaveLength(7);
    // Two styles only: artists take up to six.
    const few = lineup({ style: n('s', 2), discover: ['d'], 'on-repeat': ['r'], artist: n('a', 20), throwback: ['t'] });
    expect(few.filter((g) => g.kind === 'artist')).toHaveLength(KIND_CAPS.artist.max);
    expect(few).toHaveLength(11);
  });

  it('twelve artist mixes never crowd out the other kinds', () => {
    const got = lineup({ style: ['s0'], artist: n('a', 12), throwback: ['t'] });
    expect(got.filter((g) => g.kind === 'artist')).toHaveLength(6);
    expect(got.at(-1)?.kind).toBe('throwback');
  });

  it('empty in, empty out', () => {
    expect(lineup({})).toEqual([]);
  });

  it('cleans artist credits for names and keys', async () => {
    const { artistDisplayName } = await import('./kinds');
    expect(artistDisplayName('Gojira - Topic')).toBe('Gojira');
    expect(artistDisplayName('Metallica VEVO')).toBe('Metallica');
    expect(artistDisplayName('Dua Lipa feat. DaBaby')).toBe('Dua Lipa');
    expect(artistMixKey('Metallica VEVO')).toBe(artistMixKey('Metallica'));
  });
});
