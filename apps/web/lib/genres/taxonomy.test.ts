import { describe, expect, it } from 'vitest';
import { CHARTS, classifyTags, FAMILIES, familyOf, mapTag, mixLook, normalizeTag, parentFamilyOf } from './taxonomy';

describe('taxonomy table', () => {
  it('has nine families, each with a strong and a light colour', () => {
    expect(FAMILIES.map((f) => f.slug)).toEqual([
      'rock-metal', 'pop', 'hiphop-rnb', 'electronic', 'latin', 'balkan', 'country-folk', 'jazz-blues', 'classical',
    ]);
    for (const f of FAMILIES) {
      expect(f.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(f.tint).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives every chart a family it belongs to', () => {
    for (const c of CHARTS) expect(familyOf(c.family)).not.toBeNull();
    expect(CHARTS.filter((c) => c.family === 'rock-metal').map((c) => c.slug)).toEqual(['rock', 'hard-rock-metal']);
  });

  it('names mixes without the word Mix, splits included', () => {
    expect(mixLook('rock-metal').name).toBe('Rock & Metal');
    expect(mixLook('metal')).toMatchObject({ name: 'Metal', family: 'rock-metal' });
    expect(mixLook('rnb')).toMatchObject({ name: 'R&B', family: 'hiphop-rnb' });
    expect(parentFamilyOf('hiphop')?.slug).toBe('hiphop-rnb');
    expect(mixLook('unknown').family).toBeNull();
  });
});

describe('mapTag', () => {
  it('normalizes case, hyphens and spacing', () => {
    expect(normalizeTag('  Hip-Hop ')).toBe('hip hop');
    expect(mapTag('Hip-Hop')).toEqual({ family: 'hiphop-rnb', sub: 'hiphop' });
    expect(mapTag('K-Pop')).toEqual({ family: 'pop' });
  });

  it('ignores noise tags', () => {
    for (const noise of ['seen live', 'female vocalists', '90s', '2010s', 'german', 'american', 'favorites', 'favourites', 'awesome', '']) {
      expect(mapTag(noise)).toBeNull();
    }
  });

  it('maps ex-YU tags to Balkan, before the style they name', () => {
    for (const t of ['turbo folk', 'Turbofolk', 'narodna muzika', 'ex-yu', 'Yugoslav', 'serbian', 'Croatian', 'bosnian', 'sevdah', 'serbian rap', 'ex-yu rock', 'balkan pop']) {
      expect(mapTag(t)?.family).toBe('balkan');
    }
  });

  it('reads longer tags by keyword, metal before rock and folk', () => {
    expect(mapTag('melodic death metal')).toEqual({ family: 'rock-metal', sub: 'metal' });
    expect(mapTag('folk metal')).toEqual({ family: 'rock-metal', sub: 'metal' });
    expect(mapTag('progressive rock')).toEqual({ family: 'rock-metal', sub: 'rock' });
    expect(mapTag('deep house')).toEqual({ family: 'electronic' });
    expect(mapTag('electropop')).toEqual({ family: 'pop' });
    expect(mapTag('latin pop')).toEqual({ family: 'latin' });
    expect(mapTag('neo-soul')).toEqual({ family: 'hiphop-rnb', sub: 'rnb' });
    expect(mapTag('film score')).toEqual({ family: 'classical' });
  });
});

describe('classifyTags', () => {
  it('picks the heaviest family as primary', () => {
    const v = classifyTags([
      { name: 'metal', count: 100 },
      { name: 'progressive metal', count: 80 },
      { name: 'seen live', count: 60 },
      { name: 'rock', count: 30 },
    ]);
    expect(v.family).toBe('rock-metal');
    expect(v.sub).toBe('metal');
    expect(v.families).toEqual({ 'rock-metal': 1 });
  });

  it('keeps a secondary family at 60% of the primary or more, and drops a lighter one', () => {
    const v = classifyTags([
      { name: 'pop', count: 100 },
      { name: 'dance', count: 65 },
      { name: 'rock', count: 50 },
    ]);
    expect(v.family).toBe('pop');
    expect(v.families).toEqual({ pop: 1, electronic: 0.65 });
    // Exactly 60% is kept.
    expect(classifyTags([{ name: 'pop', count: 100 }, { name: 'jazz', count: 60 }]).families).toEqual({ pop: 1, 'jazz-blues': 0.6 });
  });

  it('a Balkan artist tagged by country and style lands in Balkan', () => {
    const v = classifyTags([
      { name: 'turbo folk', count: 100 },
      { name: 'serbian', count: 70 },
      { name: 'pop', count: 40 },
      { name: 'female vocalists', count: 30 },
    ]);
    expect(v.family).toBe('balkan');
    expect(v.families).toEqual({ balkan: 1 });
  });

  it('nothing mappable is no family', () => {
    expect(classifyTags([{ name: 'seen live', count: 100 }])).toEqual({ family: null, families: {}, sub: null });
    expect(classifyTags([])).toEqual({ family: null, families: {}, sub: null });
  });

  it('counts a tag without a count as 1, and breaks ties by first seen', () => {
    expect(classifyTags([{ name: 'jazz', count: 0 }, { name: 'rock', count: Number.NaN }]).family).toBe('jazz-blues');
  });
});
