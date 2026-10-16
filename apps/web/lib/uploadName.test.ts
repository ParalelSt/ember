import { describe, expect, it } from 'vitest';
import { guessFromFilename } from './uploadName';

describe('guessFromFilename', () => {
  it('splits "Artist - Title" on the first dash', () => {
    expect(guessFromFilename('Night Riders - Neon Hearts - Live.mp3')).toEqual({ artist: 'Night Riders', title: 'Neon Hearts - Live' });
  });

  it('takes a name without a dash as the title', () => {
    expect(guessFromFilename('Tape 01.flac')).toEqual({ artist: '', title: 'Tape 01' });
  });
});
