import { describe, expect, it } from 'vitest';
import { assembleMix, belongs, describeMix, KNOWN_MAX, MIN_MIX_SIZE, MIX_SIZE, PER_ARTIST_MAX, pickSeeds, weave, type GenreOf } from './build';
import type { MixPlan } from './cluster';
import type { SongScore } from './score';
import { tt } from '@/test-utils/mixTracks';
import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import type { Track } from '@/types/track';

const s = (t: Track, score: number): SongScore => ({ key: songKey(t), track: t, artistKey: artistKey(t.artist), score, plays: 1, liked: false });

function planOf(songs: SongScore[], over: Partial<MixPlan> = {}): MixPlan {
  const artists = [...new Set(songs.map((x) => x.artistKey))];
  return { key: 'rock-metal', family: 'rock-metal', sub: null, weight: 10, songs, artists, ...over };
}

const rockGenres = (names: string[], extra: [string, GenreOf][] = []) =>
  new Map<string, GenreOf>([...names.map((n) => [artistKey(n), { family: 'rock-metal', sub: 'rock' }] as [string, GenreOf]), ...extra]);

describe('pickSeeds', () => {
  const songs = Array.from({ length: 15 }, (_, i) => s(tt(`k${i}`, `Band ${i}`), 15 - i));
  const plan = planOf(songs);

  it('is the same all day and draws from the top ten only', () => {
    const a = pickSeeds(plan, '2026-10-16');
    const b = pickSeeds(plan, '2026-10-16');
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
    expect(a).toHaveLength(4);
    const top10 = new Set(songs.slice(0, 10).map((x) => x.key));
    expect(a.every((x) => top10.has(x.key))).toBe(true);
  });

  it('changes from day to day', () => {
    const days = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];
    const sets = new Set(days.map((d) => pickSeeds(plan, d).map((x) => x.key).join(',')));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('never picks an upload (no radio for those)', () => {
    const up = { ...s(tt('up', 'Me'), 99), track: { ...tt('up', 'Me'), source: 'upload' as const } };
    expect(pickSeeds(planOf([up, ...songs]), '2026-10-16').some((x) => x.track.source === 'upload')).toBe(false);
  });
});

describe('weave', () => {
  it('opens with two known songs, then one known in every three', () => {
    const known = ['k1', 'k2', 'k3', 'k4'].map((x) => tt(x, 'K'));
    const fresh = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((x) => tt(x, 'F'));
    expect(weave(known, fresh).map((t) => t.title.split(' ')[1])).toEqual(['k1', 'k2', 'f1', 'k3', 'f2', 'f3', 'k4', 'f4', 'f5', 'f6']);
  });

  it('stops at the size', () => {
    expect(weave([tt('a', 'A')], Array.from({ length: 80 }, (_, i) => tt(`f${i}`, 'F')))).toHaveLength(MIX_SIZE);
  });
});

describe('belongs', () => {
  const genres = new Map<string, GenreOf>([
    ['rocker', { family: 'rock-metal', sub: 'rock' }],
    ['metalhead', { family: 'rock-metal', sub: 'metal' }],
    ['popstar', { family: 'pop', sub: null }],
    ['banned', { family: null, sub: null, manual: true }],
  ]);
  const plan = { family: 'rock-metal' as const, sub: null };

  it('takes the family, drops other families', () => {
    expect(belongs(plan, 'rocker', genres, 1, new Set())).toBe(true);
    expect(belongs(plan, 'popstar', genres, 5, new Set())).toBe(false);
  });

  it('a split mix takes its own half only', () => {
    expect(belongs({ family: 'rock-metal', sub: 'metal' }, 'metalhead', genres, 1, new Set())).toBe(true);
    expect(belongs({ family: 'rock-metal', sub: 'metal' }, 'rocker', genres, 1, new Set())).toBe(false);
  });

  it('an untagged artist needs two radios and no other family\'s chart; an admin\'s "no family" never', () => {
    expect(belongs(plan, 'nobody', genres, 1, new Set())).toBe(false);
    expect(belongs(plan, 'nobody', genres, 2, new Set())).toBe(true);
    expect(belongs(plan, 'nobody', genres, 3, new Set(['nobody']))).toBe(false);
    expect(belongs(plan, 'banned', genres, 5, new Set())).toBe(false);
  });
});

describe('assembleMix', () => {
  const ownBands = ['Foo', 'Pearl', 'Soundgarden', 'Alice', 'Nirvana', 'Pixies', 'Weezer', 'Blur'];
  const own = ownBands.flatMap((b, i) => [0, 1, 2, 3].map((j) => s(tt(`o${i}${j}`, b), 40 - i * 4 - j)));
  const radioBands = Array.from({ length: 20 }, (_, i) => `New Rock ${i}`);
  const radio = (seed: string) => ({ seed, tracks: radioBands.map((b, i) => tt(`r${seed}${i}`, b)) });

  it('takes up to 20 known songs (3 per artist), then new songs, 50 in all', () => {
    const tracks = assembleMix({
      plan: planOf(own), radios: [radio('a'), radio('b'), radio('c')], chartTracks: [],
      genres: rockGenres([...ownBands, ...radioBands]), otherFamilyChartArtists: new Set(), unavailable: new Set(),
    })!;
    expect(tracks).toHaveLength(MIX_SIZE);
    const ownIds = new Set(own.map((x) => x.track.id));
    expect(tracks.filter((t) => ownIds.has(t.id))).toHaveLength(KNOWN_MAX);
    const per = new Map<string, number>();
    for (const t of tracks) per.set(t.artist, (per.get(t.artist) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(PER_ARTIST_MAX);
    // Opens with the member's two best songs.
    expect(tracks.slice(0, 2).map((t) => t.id)).toEqual([own[0].track.id, own[1].track.id]);
  });

  it('drops dead songs and songs already in the known part (another version included)', () => {
    const plan = planOf(own.slice(0, 8));
    const dupe = { ...tt('dupe', own[0].track.artist, `${own[0].track.title} (Official Video)`) };
    const dead = tt('dead', 'New Rock 1');
    const tracks = assembleMix({
      plan, radios: [{ seed: 'x', tracks: [dupe, dead, ...radioBands.map((b, i) => tt(`q${i}`, b))] }], chartTracks: [],
      genres: rockGenres([...ownBands, ...radioBands]), otherFamilyChartArtists: new Set(), unavailable: new Set([dead.id, own[2].track.id]),
    })!;
    const ids = tracks.map((t) => t.id);
    expect(ids).not.toContain(dupe.id);
    expect(ids).not.toContain(dead.id);
    expect(ids).not.toContain(own[2].track.id);
  });

  it('fills from the family chart after the radios', () => {
    const chart = Array.from({ length: 30 }, (_, i) => tt(`c${i}`, `Chart Band ${i}`));
    const tracks = assembleMix({
      plan: planOf(own.slice(0, 6)), radios: [], chartTracks: chart,
      genres: rockGenres([...ownBands, ...chart.map((t) => t.artist)]), otherFamilyChartArtists: new Set(), unavailable: new Set(),
    })!;
    expect(tracks.length).toBeGreaterThanOrEqual(MIN_MIX_SIZE);
    expect(tracks.some((t) => t.artist.startsWith('Chart Band'))).toBe(true);
  });

  it('is null under 20 songs', () => {
    expect(assembleMix({
      plan: planOf(own.slice(0, 5)), radios: [radio('a')], chartTracks: [],
      genres: rockGenres(ownBands), otherFamilyChartArtists: new Set(), unavailable: new Set(),
    })).toBeNull();
  });
});

describe('describeMix', () => {
  it('names the mix without "Mix", lists its top three artists and their covers', () => {
    const songs = [s(tt('a', 'Linkin Park'), 9), s(tt('b', 'System Of A Down'), 8), s(tt('c', 'Deftones'), 7), s(tt('d', 'Korn'), 1)];
    const meta = describeMix(planOf(songs), songs.map((x) => x.track));
    expect(meta.title).toBe('Rock & Metal');
    expect(meta.subtitle).toBe('Linkin Park, System Of A Down, Deftones and more');
    expect(meta.artworkUrls).toHaveLength(3);
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
