import { describe, expect, it } from 'vitest';
import { songKey, findLikedVariant } from './songKey';
import type { Track } from '@/types/track';

function track(overrides: Partial<Track>): Track {
  return {
    id: 't1',
    source: 'youtube',
    sourceId: 's1',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: 'https://example.com/s1',
    ...overrides,
  };
}

describe('songKey', () => {
  it('is case-insensitive', () => {
    expect(songKey({ title: 'Blinding Lights', artist: 'The Weeknd' }))
      .toBe(songKey({ title: 'BLINDING LIGHTS', artist: 'THE WEEKND' }));
  });

  it('strips parenthetical version noise', () => {
    expect(songKey({ title: 'Blinding Lights (Official Video)', artist: 'The Weeknd' }))
      .toBe(songKey({ title: 'Blinding Lights', artist: 'The Weeknd' }));
  });

  it('does NOT collapse a (Live) title into the plain title — it is a different recording', () => {
    expect(songKey({ title: 'Blinding Lights (Live)', artist: 'The Weeknd' }))
      .not.toBe(songKey({ title: 'Blinding Lights', artist: 'The Weeknd' }));
  });

  it('strips bracketed version noise', () => {
    expect(songKey({ title: 'Blinding Lights [Lyrics]', artist: 'The Weeknd' }))
      .toBe(songKey({ title: 'Blinding Lights', artist: 'The Weeknd' }));
  });

  it('strips a feat./ft. suffix and everything after it', () => {
    expect(songKey({ title: 'Some Song feat. Drake', artist: 'Artist' }))
      .toBe(songKey({ title: 'Some Song', artist: 'Artist' }));
    expect(songKey({ title: 'Some Song ft. Drake', artist: 'Artist' }))
      .toBe(songKey({ title: 'Some Song', artist: 'Artist' }));
  });

  it('strips remaster/official/hd/hq noise words', () => {
    expect(songKey({ title: 'Some Song Remastered', artist: 'Artist' }))
      .toBe(songKey({ title: 'Some Song', artist: 'Artist' }));
    expect(songKey({ title: 'Some Song HD', artist: 'Artist' }))
      .toBe(songKey({ title: 'Some Song', artist: 'Artist' }));
  });

  it('normalizes punctuation to spaces (including apostrophes)', () => {
    expect(songKey({ title: "Don't Stop Me Now!", artist: 'Queen' }))
      .toBe(songKey({ title: 'Don t Stop Me Now', artist: 'Queen' }));
  });

  it('strips "- Topic" and Vevo noise from the artist', () => {
    expect(songKey({ title: 'Song', artist: 'The Weeknd - Topic' }))
      .toBe(songKey({ title: 'Song', artist: 'The Weeknd' }));
    expect(songKey({ title: 'Song', artist: 'The Weeknd VEVO' }))
      .toBe(songKey({ title: 'Song', artist: 'The Weeknd' }));
  });

  it('different songs by the same artist produce different keys', () => {
    expect(songKey({ title: 'Blinding Lights', artist: 'The Weeknd' }))
      .not.toBe(songKey({ title: 'Save Your Tears', artist: 'The Weeknd' }));
  });

  it('a title that is entirely version noise falls back to the raw lowercased title, not an empty key', () => {
    const key = songKey({ title: '(Official Video)', artist: 'Artist' });
    expect(key).toBe('(official video)::::artist');
  });

  // The bug report: an instrumental and the normal version of a song were
  // treated as one identity (shared likes, radio dedup, and the unavailable-
  // track replacement pool all key off songKey). Every pair below must NOT
  // share a key; a plain-punctuation/feat. variant of the SAME recording
  // must still share one.
  const BASE = { title: "Welcome Back O' Sleeping Dreamer", artist: 'Lorna Shore' };
  const MUST_NOT_MATCH: [string, string][] = [
    ['instrumental', "Welcome Back O' Sleeping Dreamer (Instrumental)"],
    ['live', "Welcome Back O' Sleeping Dreamer (Live)"],
    ['remix', "Welcome Back O' Sleeping Dreamer (Remix)"],
    ['acoustic', "Welcome Back O' Sleeping Dreamer (Acoustic)"],
    ['karaoke', "Welcome Back O' Sleeping Dreamer (Karaoke Version)"],
    ['sped up', "Welcome Back O' Sleeping Dreamer (Sped Up)"],
    ['slowed', "Welcome Back O' Sleeping Dreamer (Slowed + Reverb)"],
    ['cover', "Welcome Back O' Sleeping Dreamer (Cover)"],
    ['demo', "Welcome Back O' Sleeping Dreamer (Demo)"],
    ['extended', "Welcome Back O' Sleeping Dreamer (Extended)"],
    ['clean', "Welcome Back O' Sleeping Dreamer (Clean)"],
    ['censored', "Welcome Back O' Sleeping Dreamer (Censored)"],
    ['radio edit', "Welcome Back O' Sleeping Dreamer (Radio Edit)"],
  ];
  it.each(MUST_NOT_MATCH)('a %s title does not share a key with the plain version', (_label, variantTitle) => {
    expect(songKey({ title: variantTitle, artist: BASE.artist })).not.toBe(songKey(BASE));
  });

  const MUST_MATCH: [string, string, string][] = [
    ['punctuation only', "Welcome Back O' Sleeping Dreamer", 'Welcome Back O Sleeping Dreamer!'],
    ['feat. suffix', 'Some Song', 'Some Song feat. Artist Two'],
    ['ft. spelling', 'Some Song', 'Some Song ft. Artist Two'],
    ['official video noise', 'Some Song', 'Some Song (Official Video)'],
    ['case only', 'Some Song', 'SOME SONG'],
  ];
  it.each(MUST_MATCH)('%s: two spellings of the same recording share a key', (_label, a, b) => {
    expect(songKey({ title: a, artist: BASE.artist })).toBe(songKey({ title: b, artist: BASE.artist }));
  });

  it('two different variant markers on the same base title also differ from each other', () => {
    expect(songKey({ title: "Welcome Back O' Sleeping Dreamer (Instrumental)", artist: BASE.artist }))
      .not.toBe(songKey({ title: "Welcome Back O' Sleeping Dreamer (Live)", artist: BASE.artist }));
  });
});

describe('findLikedVariant', () => {
  it('returns null for a null/undefined track', () => {
    expect(findLikedVariant(null, [track({})])).toBeNull();
    expect(findLikedVariant(undefined, [track({})])).toBeNull();
  });

  it('matches by id first', () => {
    const liked = [track({ id: 'a', title: 'Other Title' })];
    expect(findLikedVariant(track({ id: 'a' }), liked)).toBe(liked[0]);
  });

  it('matches a different id if the songKey matches (a version variant)', () => {
    const liked = [track({ id: 'liked-1', title: 'Blinding Lights (Official Video)' })];
    const playing = track({ id: 'playing-1', title: 'Blinding Lights' });
    expect(findLikedVariant(playing, liked)).toBe(liked[0]);
  });

  it('returns null when nothing matches', () => {
    const liked = [track({ id: 'liked-1', title: 'Save Your Tears' })];
    const playing = track({ id: 'playing-1', title: 'Blinding Lights' });
    expect(findLikedVariant(playing, liked)).toBeNull();
  });
});
