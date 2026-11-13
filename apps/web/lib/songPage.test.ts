import { describe, expect, it } from 'vitest';
import { artistPageHref, songPageHref } from './songPage';

describe('songPageHref', () => {
  it('a YouTube song opens /track/<videoId>', () => {
    expect(songPageHref({ source: 'youtube', sourceId: '-UaaeSP971U' })).toBe('/track/-UaaeSP971U');
  });

  it('uploads, stations and nothing have no song page', () => {
    expect(songPageHref({ source: 'upload', sourceId: 'abc' })).toBeNull();
    expect(songPageHref({ source: 'station', sourceId: 'abc' })).toBeNull();
    expect(songPageHref(null)).toBeNull();
  });
});

describe('artistPageHref', () => {
  it('needs an artist id', () => {
    expect(artistPageHref({ artistId: 'UC1' })).toBe('/artist/UC1');
    expect(artistPageHref({ artistId: null })).toBeNull();
  });
});
