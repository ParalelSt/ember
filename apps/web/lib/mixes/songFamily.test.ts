import { describe, expect, it } from 'vitest';
import { resolveGenre } from './songFamily';
import type { GenreOf } from './build';

// One precedence: admin row, strong title signal, the artist's family, weak
// title signal, nothing.

const genres = new Map<string, GenreOf>([
  ['pop star', { family: 'pop', sub: null }],
  ['hans zimmer', { family: 'classical', sub: 'soundtrack' }],
  ['chart act', { family: 'rock-metal', sub: 'rock' }],
  ['admin pop', { family: 'pop', sub: null, manual: true }],
  ['admin none', { family: null, sub: null, manual: true }],
]);
const r = (title: string, artist: string, album: string | null = null) => resolveGenre({ title, artist, album }, genres);

describe('resolveGenre', () => {
  it('1. an admin row stands, even over a strong signal', () => {
    expect(r('Theme (Undertale OST)', 'Admin Pop')).toMatchObject({ family: 'pop', via: 'manual', manual: true });
    expect(r('Theme (Undertale OST)', 'Admin None')).toMatchObject({ family: null, via: 'manual', manual: true });
  });

  it('2. a strong signal beats the artist tags', () => {
    expect(r('Enemy (League of Legends)', 'Pop Star')).toEqual({ family: 'game-anime', sub: null, via: 'signal' });
  });

  it('3. the artist family (tags or a chart prior) beats a weak signal', () => {
    expect(r('Time (Original Soundtrack)', 'Hans Zimmer')).toEqual({ family: 'classical', sub: 'soundtrack', via: 'tags' });
    expect(r('Plain Song', 'Chart Act')).toEqual({ family: 'rock-metal', sub: 'rock', via: 'tags' });
  });

  it('4. a weak signal places an artist with no family', () => {
    expect(r('Main Theme (Original Soundtrack)', 'Unknown Channel')).toEqual({ family: 'game-anime', sub: null, via: 'weak-signal' });
  });

  it('5. nothing is untagged', () => {
    expect(r('Heart of Corruption', 'Lappy')).toEqual({ family: null, sub: null, via: null });
  });
});
