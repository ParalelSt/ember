import { describe, expect, it } from 'vitest';
import { ARTIST_OWN_MAX, artistPlans, assembleArtistMix, describeArtistMix, fitsArtist, type ArtistPlan } from './artist';
import { MIN_MIX_SIZE, PER_ARTIST_MAX, type GenreOf } from './build';
import { scoreArtists, type SongScore } from './score';
import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import { tt } from '@/test-utils/mixTracks';
import type { Track } from '@/types/track';

const s = (t: Track, score: number): SongScore => ({ key: songKey(t), track: t, artistKey: artistKey(t.artist), score, plays: 1, liked: false });
const own = (artist: string, count: number, score = 2) => Array.from({ length: count }, (_, i) => s(tt(`${artist.slice(0, 4)}${i}`, artist, `Song ${i} by ${artist.slice(0, 4)}`), score));

describe('artistPlans', () => {
  it('one per artist with three songs and enough weight, best first, up to max', () => {
    const songs = [...own('Gojira', 4, 3), ...own('Tool', 3, 1.5), ...own('Thin', 2, 5), ...own('Light', 3, 0.5), ...own('Mastodon', 3, 1)];
    const plans = artistPlans(scoreArtists(songs), new Map([['gojira', { family: 'rock-metal', sub: 'metal' }]]), 6);
    // Thin has two songs; Light weighs 1.5.
    expect(plans.map((p) => p.key)).toEqual(['artist-gojira', 'artist-tool', 'artist-mastodon']);
    expect(plans[0]).toMatchObject({ name: 'Gojira', family: 'rock-metal', artistKey: 'gojira' });
    expect(artistPlans(scoreArtists(songs), new Map(), 1)).toHaveLength(1);
  });

  it('needs a YouTube song to seed the radio, and names the lead artist', () => {
    const uploads = own('Me', 4, 3).map((x) => ({ ...x, track: { ...x.track, source: 'upload' as const } }));
    const feat = own('Dua Lipa feat. DaBaby', 3, 2);
    const plans = artistPlans(scoreArtists([...uploads, ...feat]), new Map(), 6);
    expect(plans.map((p) => [p.key, p.name])).toEqual([['artist-dua-lipa', 'Dua Lipa']]);
  });
});

describe('fitsArtist', () => {
  it('unknown artists fit, the same family fits, another family or an admin "no family" does not', () => {
    expect(fitsArtist('rock-metal', undefined)).toBe(true);
    expect(fitsArtist('rock-metal', { family: 'rock-metal', sub: 'rock' })).toBe(true);
    expect(fitsArtist('rock-metal', { family: 'pop', sub: null })).toBe(false);
    expect(fitsArtist('rock-metal', { family: null, sub: null, manual: true })).toBe(false);
    expect(fitsArtist(null, { family: 'pop', sub: null })).toBe(true);
  });
});

describe('assembleArtistMix', () => {
  const plan: ArtistPlan = { key: 'artist-gojira', artistKey: 'gojira', name: 'Gojira', family: 'rock-metal', weight: 20, songs: own('Gojira', 6, 3) };
  const radioOf = (seed: string) => ({
    seed,
    tracks: [
      ...Array.from({ length: 15 }, (_, i) => tt(`g${seed}${i}`, 'Gojira', `Gojira radio ${seed} ${i}`)),
      ...Array.from({ length: 20 }, (_, i) => tt(`m${seed}${i}`, `Similar ${i % 8}`)),
      tt(`p${seed}`, 'Pop Star'),
    ],
  });
  const genres = new Map<string, GenreOf>([['pop star', { family: 'pop', sub: null }]]);

  it('the artist first (capped at twelve), similar artists at three each, no other family', () => {
    const tracks = assembleArtistMix({ plan, radios: [radioOf('a'), radioOf('b'), radioOf('c')], genres, unavailable: new Set() })!;
    expect(tracks.length).toBeGreaterThanOrEqual(MIN_MIX_SIZE);
    expect(tracks[0].id).toBe(plan.songs[0].track.id);
    expect(tracks.filter((t) => t.artist === 'Gojira')).toHaveLength(ARTIST_OWN_MAX);
    for (let i = 0; i < 8; i++) expect(tracks.filter((t) => t.artist === `Similar ${i}`).length).toBeLessThanOrEqual(PER_ARTIST_MAX);
    expect(tracks.some((t) => t.artist === 'Pop Star')).toBe(false);
    expect(new Set(tracks.map(songKey)).size).toBe(tracks.length);
  });

  it('skips dead and blocked songs, and is null when too few are left', () => {
    const dead = new Set([plan.songs[0].track.id]);
    const tracks = assembleArtistMix({ plan, radios: [radioOf('a')], genres, unavailable: dead, skip: (t) => t.artist === 'Similar 1' })!;
    expect(tracks.some((t) => dead.has(t.id) || t.artist === 'Similar 1')).toBe(false);
    expect(assembleArtistMix({ plan, radios: [], genres, unavailable: new Set() })).toBeNull();
  });

  it('describes the card: artist name, the artist and two similar ones with covers', () => {
    const tracks = assembleArtistMix({ plan, radios: [radioOf('a'), radioOf('b')], genres, unavailable: new Set() })!;
    const meta = describeArtistMix(plan, tracks, '#c9c3d6');
    expect(meta.title).toBe('Gojira');
    expect(meta.subtitle).toMatch(/^Gojira, Similar \d, Similar \d and more$/);
    expect(meta.artworkUrls).toHaveLength(3);
    expect(meta.artworkUrls[0]).toBe(plan.songs[0].track.artworkUrl);
    expect(meta.color).toBe('#c9c3d6');
  });
});
