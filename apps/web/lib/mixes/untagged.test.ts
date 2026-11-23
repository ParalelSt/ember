import { describe, expect, it } from 'vitest';
import { CONTRA_MIN, radioSpeaksFor, untaggedHomes, untaggedMinRadios, type SeedRadio } from './untagged';
import type { GenreOf } from './build';
import type { FamilySlug } from '../genres/taxonomy';
import { tt } from '@/test-utils/mixTracks';
import { artistKey } from '../genres/artistKey';
import type { Track } from '@/types/track';

let n = 0;
const genres = new Map<string, GenreOf>();
const tagged = (family: FamilySlug, count: number): Track[] =>
  Array.from({ length: count }, (_, i) => {
    const name = `${family} artist ${n++}`;
    genres.set(artistKey(name), { family, sub: null });
    return tt(`t${n}x${i}`, name, `Song ${n}`);
  });
const by = (artist: string, title = `Plain ${n++}`) => tt(`u${n++}`, artist, title);
const radio = (family: FamilySlug, seed: string, tracks: Track[]): SeedRadio => ({ family, seed, tracks });

genres.set('admin none', { family: null, sub: null, manual: true });

describe('radioSpeaksFor', () => {
  it('speaks for its own mix when nothing contradicts it', () => {
    expect(radioSpeaksFor(radio('pop', 's1', [...tagged('pop', 6), ...tagged('rock-metal', 4)]), genres)).toBe('pop');
  });

  it(`speaks for another family with at least ${CONTRA_MIN} songs and a majority over the own family`, () => {
    expect(radioSpeaksFor(radio('pop', 's2', [...tagged('pop', 2), ...tagged('game-anime', 9)]), genres)).toBe('game-anime');
    expect(radioSpeaksFor(radio('pop', 's3', [...tagged('pop', 5), ...tagged('game-anime', 5)]), genres)).toBe('pop');
  });

  it(`${CONTRA_MIN - 1} songs are not enough, and unknown songs do not count either way`, () => {
    expect(radioSpeaksFor(radio('pop', 's4', [...tagged('game-anime', CONTRA_MIN - 1), by('Unknown A'), by('Unknown B')]), genres)).toBe('pop');
    expect(radioSpeaksFor(radio('pop', 's5', Array.from({ length: 20 }, () => by('Nobody'))), genres)).toBe('pop');
  });

  it('counts songs whose title says game music, whoever uploaded them', () => {
    const titled = Array.from({ length: 6 }, (_, i) => by(`Channel ${i}`, `Stage ${i} (Undertale OST)`));
    expect(radioSpeaksFor(radio('pop', 's6', [...tagged('pop', 1), ...titled]), genres)).toBe('game-anime');
  });

  it('two other families tied at the top contradict nothing', () => {
    expect(radioSpeaksFor(radio('pop', 's7', [...tagged('rock-metal', 6), ...tagged('latin', 6)]), genres)).toBe('pop');
  });
});

describe('untaggedHomes', () => {
  const pop = (seed: string, extra: Track[]) => radio('pop', seed, [...tagged('pop', 10), ...extra]);
  const game = (seed: string, extra: Track[]) => radio('game-anime', seed, [...tagged('game-anime', 10), ...extra]);

  it('a channel with a signalled upload anywhere tonight is Game & Anime', () => {
    expect(untaggedHomes([pop('a', [by('Lappy')]), pop('b', [by('Lappy')])], genres, [by('Lappy', 'Boss Theme')]).get('lappy')).toBe('game-anime');
    expect(untaggedHomes([pop('a', [by('Ch'), by('Ch', 'Theme (Touhou)')])], genres, []).get('ch')).toBe('game-anime');
  });

  it('game 1 vs pop 1 is Game & Anime (ties go there); game 1 vs pop 2 is Pop', () => {
    expect(untaggedHomes([game('g', [by('X')]), pop('p', [by('X')])], genres, []).get('x')).toBe('game-anime');
    expect(untaggedHomes([game('g', [by('X')]), pop('p1', [by('X')]), pop('p2', [by('X')])], genres, []).get('x')).toBe('pop');
  });

  it('balkan 3 vs game 1 is Balkan', () => {
    const balkan = (seed: string) => radio('balkan', seed, [...tagged('balkan', 10), by('Y')]);
    expect(untaggedHomes([balkan('b1'), balkan('b2'), balkan('b3'), game('g', [by('Y')])], genres, []).get('y')).toBe('balkan');
  });

  it('pop 2 vs rock 2 is no home; one pop radio is no home', () => {
    const rock = (seed: string) => radio('rock-metal', seed, [...tagged('rock-metal', 10), by('Z')]);
    expect(untaggedHomes([pop('p1', [by('Z')]), pop('p2', [by('Z')]), rock('r1'), rock('r2')], genres, []).has('z')).toBe(false);
    expect(untaggedHomes([pop('p1', [by('W')])], genres, []).has('w')).toBe(false);
  });

  it('an out-of-place pop radio counts for Game & Anime, not Pop', () => {
    const gamey = (seed: string) => radio('pop', seed, [...tagged('pop', 1), ...tagged('game-anime', 8), by('Uploader')]);
    expect(untaggedHomes([gamey('p1'), gamey('p2')], genres, []).get('uploader')).toBe('game-anime');
  });

  it('a tagged or admin artist is never in the map', () => {
    const [known] = tagged('pop', 1);
    const homes = untaggedHomes([pop('p1', [known, by('Admin None')]), pop('p2', [known, by('Admin None')])], genres, []);
    expect(homes.size).toBe(0);
  });

  it('a seed shared by a family mix and its sub-genre mix counts once', () => {
    const shared = [...tagged('rock-metal', 10), by('Q')];
    expect(untaggedHomes([radio('rock-metal', 's', shared), radio('rock-metal', 's', shared)], genres, []).has('q')).toBe(false);
  });

  it('Game & Anime takes an unknown artist from one radio, other families from two', () => {
    expect(untaggedMinRadios('game-anime')).toBe(1);
    expect(untaggedMinRadios('pop')).toBe(2);
  });
});
