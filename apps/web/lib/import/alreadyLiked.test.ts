import { describe, expect, it } from 'vitest';
import { artistParts, isAlreadyLiked, likedIndex, splitAlreadyLiked } from './alreadyLiked';

const liked = likedIndex([
  { title: 'Copper Sky', artist: 'Coastline', sourceId: 'vid-copper' },
  { title: 'Weather Maps (Official Video)', artist: 'Mira Vale - Topic', sourceId: 'vid-maps' },
  { title: 'Glasshouse', artist: 'Pale Orchard, Nora Quill', sourceId: 'vid-glass' },
]);

describe('already liked, by name', () => {
  it('the same song by the same artist is already liked, whatever the noise', () => {
    expect(isAlreadyLiked({ title: 'Copper Sky', artist: 'Coastline' }, liked)).toBe(true);
    expect(isAlreadyLiked({ title: 'COPPER SKY', artist: 'coastline' }, liked)).toBe(true);
    expect(isAlreadyLiked({ title: 'Weather Maps', artist: 'Mira Vale' }, liked)).toBe(true);
  });

  it('one shared artist is enough, either way round', () => {
    expect(isAlreadyLiked({ title: 'Glasshouse', artist: 'Nora Quill' }, liked)).toBe(true);
    expect(isAlreadyLiked({ title: 'Copper Sky', artist: 'Coastline, June Harbor', artists: ['Coastline', 'June Harbor'] }, liked)).toBe(true);
  });

  it('another artist, another song, or another version is not', () => {
    expect(isAlreadyLiked({ title: 'Copper Sky', artist: 'Lantern Kids' }, liked)).toBe(false);
    expect(isAlreadyLiked({ title: 'Paper Lanterns', artist: 'Coastline' }, liked)).toBe(false);
    expect(isAlreadyLiked({ title: 'Copper Sky (Live)', artist: 'Coastline' }, liked)).toBe(false);
  });

  it('the exact YouTube video of a like is already liked', () => {
    expect(isAlreadyLiked({ title: 'Something else', artist: 'Someone', videoId: 'vid-copper' }, liked)).toBe(true);
  });

  it('splits artist lines the way sources write them', () => {
    expect(artistParts('June Harbor, Mira Vale & Coastline feat. Nora Quill')).toEqual(['June Harbor', 'Mira Vale', 'Coastline', 'Nora Quill']);
  });
});

describe('splitAlreadyLiked', () => {
  it('leaves the liked ones out and renumbers the rest in source order', () => {
    const items = [
      { position: 0, title: 'Paper Lanterns', artist: 'June Harbor' },
      { position: 1, title: 'Copper Sky', artist: 'Coastline' },
      { position: 2, title: 'Northbound', artist: 'Mira Vale' },
    ];
    const { fresh, liked: already } = splitAlreadyLiked(items, liked);
    expect(fresh.map((i) => [i.position, i.title])).toEqual([
      [0, 'Paper Lanterns'],
      [1, 'Northbound'],
    ]);
    expect(already.map((i) => i.title)).toEqual(['Copper Sky']);
  });
});
