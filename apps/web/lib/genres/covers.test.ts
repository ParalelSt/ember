import { describe, expect, it } from 'vitest';
import { topCovers } from './covers';

describe('topCovers', () => {
  it('makes a mosaic of four distinct covers', () => {
    const t = ['a', 'a', null, 'b', 'c', 'd', 'e'].map((artworkUrl) => ({ artworkUrl }));
    expect(topCovers(t)).toEqual({ src: null, mosaic: ['a', 'b', 'c', 'd'] });
  });
  it('uses the first cover alone with fewer than four, and nothing without art', () => {
    expect(topCovers([{ artworkUrl: 'a' }, { artworkUrl: 'b' }])).toEqual({ src: 'a' });
    expect(topCovers([])).toEqual({ src: null });
  });
});
