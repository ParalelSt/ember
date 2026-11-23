import { describe, expect, it } from 'vitest';
import { CHARTS, classifyTags, FAMILIES, familyOf, isSubSlug, mapTag, mixLook, normalizeTag, parentFamilyOf, subOfTags } from './taxonomy';

describe('taxonomy table', () => {
  it('has ten families, Game & Anime last, each with a strong and a light colour', () => {
    expect(FAMILIES.map((f) => f.slug)).toEqual([
      'rock-metal', 'pop', 'hiphop-rnb', 'electronic', 'latin', 'balkan', 'country-folk', 'jazz-blues', 'classical', 'game-anime',
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
    expect(mixLook('game-anime')).toMatchObject({ name: 'Game & Anime', tint: '#f5ee9e', family: 'game-anime' });
  });

  it('Game & Anime has no chart and no sub-genres', () => {
    expect(CHARTS.some((c) => c.family === 'game-anime')).toBe(false);
    expect(familyOf('game-anime')?.subs).toBeUndefined();
  });
});

describe('mapTag: Game & Anime', () => {
  it('maps the scene, its games and its sounds', () => {
    for (const t of [
      'vocaloid', 'Touhou', 'anime', 'vgm', 'video game music', 'Video Games', 'game', 'game soundtrack', 'video game soundtrack',
      'j-core', 'jcore', 'chiptune', '8-bit', 'minecraft', 'Undertale', 'osu!', 'rhythm game', 'BMS', 'anison', 'utaite', 'doujin',
      'seiyuu', 'visual novel', 'Pokémon', 'hatsune miku', '東方', 'ボカロ',
    ]) {
      expect(mapTag(t), t).toEqual({ family: 'game-anime' });
    }
  });

  it('beats the style it is combined with, but not the Balkan rule', () => {
    expect(mapTag('vocaloid rock')).toEqual({ family: 'game-anime' });
    expect(mapTag('touhou metal')).toEqual({ family: 'game-anime' });
    expect(mapTag('anime pop')).toEqual({ family: 'game-anime' });
    expect(mapTag('serbian anime')).toEqual({ family: 'balkan' });
  });

  it('leaves J-pop, J-rock, film scores and look-alike words where they were', () => {
    expect(mapTag('j-pop')).toEqual({ family: 'pop' });
    expect(mapTag('j pop')).toEqual({ family: 'pop' });
    expect(mapTag('k-pop')).toEqual({ family: 'pop' });
    expect(mapTag('j-rock')).toEqual({ family: 'rock-metal' });
    expect(mapTag('japanese')).toBeNull();
    expect(mapTag('soundtrack')).toEqual({ family: 'classical' });
    expect(mapTag('film score')).toEqual({ family: 'classical' });
    expect(mapTag('doom metal')).toEqual({ family: 'rock-metal' });
    expect(mapTag('animal')).toBeNull();
    expect(mapTag('the game')).toBeNull();
  });
});

describe('mapTag', () => {
  it('normalizes case, hyphens and spacing', () => {
    expect(normalizeTag('  Hip-Hop ')).toBe('hip hop');
    expect(mapTag('Hip-Hop')).toEqual({ family: 'hiphop-rnb' });
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
    expect(mapTag('melodic death metal')).toEqual({ family: 'rock-metal' });
    expect(mapTag('folk metal')).toEqual({ family: 'rock-metal' });
    expect(mapTag('progressive rock')).toEqual({ family: 'rock-metal' });
    expect(mapTag('deep house')).toEqual({ family: 'electronic' });
    expect(mapTag('electropop')).toEqual({ family: 'pop' });
    expect(mapTag('latin pop')).toEqual({ family: 'latin' });
    expect(mapTag('neo-soul')).toEqual({ family: 'hiphop-rnb' });
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

  it('a vocaloid producer is Game & Anime, a J-pop singer and a rhythm-game DJ are not', () => {
    expect(classifyTags([{ name: 'vocaloid', count: 100 }, { name: 'j-pop', count: 60 }, { name: 'japanese', count: 50 }]).family).toBe('game-anime');
    expect(classifyTags([{ name: 'j-pop', count: 100 }, { name: 'japanese', count: 70 }, { name: 'anime', count: 20 }]).family).toBe('pop');
    const dj = classifyTags([{ name: 'electronic', count: 100 }, { name: 'j-core', count: 60 }, { name: 'dubstep', count: 40 }]);
    expect(dj.family).toBe('electronic');
    expect(dj.families).toEqual({ electronic: 1 });
  });

  it('counts a tag without a count as 1, and breaks ties by first seen', () => {
    expect(classifyTags([{ name: 'jazz', count: 0 }, { name: 'rock', count: Number.NaN }]).family).toBe('jazz-blues');
  });
});

describe('sub-genres (style mixes)', () => {
  it('every sub-genre slug is unique, short, URL-safe and never a family slug', () => {
    const slugs = FAMILIES.flatMap((f) => (f.subs ?? []).map((s) => s.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s).toMatch(/^[a-z0-9-]{1,20}$/);
      expect(familyOf(s)).toBeNull();
      expect(isSubSlug(s)).toBe(true);
      expect(mixLook(s).family).not.toBeNull();
    }
    for (const reserved of ['discover', 'on-repeat', 'throwback']) expect(slugs).not.toContain(reserved);
    expect(isSubSlug('nope')).toBe(false);
  });

  it('keeps the original halves: Rock and Metal, Hip-hop and R&B', () => {
    expect(subOfTags('rock-metal', [{ name: 'metal', count: 100 }, { name: 'rock', count: 30 }])).toBe('metal');
    expect(subOfTags('rock-metal', [{ name: 'hard rock', count: 10 }])).toBe('metal');
    expect(subOfTags('rock-metal', [{ name: 'classic rock', count: 10 }, { name: 'alternative', count: 5 }])).toBe('rock');
    expect(subOfTags('hiphop-rnb', [{ name: 'neo-soul', count: 10 }, { name: 'rap', count: 5 }])).toBe('rnb');
  });

  it('reads the narrower styles from the tags', () => {
    expect(subOfTags('rock-metal', [{ name: 'pop punk', count: 80 }, { name: 'rock', count: 50 }])).toBe('punk');
    expect(subOfTags('rock-metal', [{ name: 'indie rock', count: 90 }, { name: 'rock', count: 40 }])).toBe('indie');
    expect(subOfTags('electronic', [{ name: 'deep house', count: 70 }, { name: 'electronic', count: 100 }])).toBe('house');
    expect(subOfTags('electronic', [{ name: 'drum and bass', count: 70 }])).toBe('dnb');
    expect(subOfTags('pop', [{ name: 'k-pop', count: 100 }, { name: 'pop', count: 100 }])).toBe('kpop');
    expect(subOfTags('latin', [{ name: 'reggaeton', count: 100 }])).toBe('reggaeton');
    expect(subOfTags('country-folk', [{ name: 'singer-songwriter', count: 100 }])).toBe('folk');
    expect(subOfTags('jazz-blues', [{ name: 'delta blues', count: 100 }])).toBe('blues');
    expect(subOfTags('classical', [{ name: 'soundtrack', count: 100 }])).toBe('soundtrack');
    // Game music is its own family now, not a Classical soundtrack.
    expect(subOfTags('classical', [{ name: 'video game music', count: 100 }])).toBeNull();
  });

  it('splits Balkan by style: a plain style tag counts once the family is Balkan', () => {
    expect(subOfTags('balkan', [{ name: 'turbo folk', count: 100 }, { name: 'serbian', count: 70 }, { name: 'pop', count: 40 }])).toBe('turbofolk');
    expect(subOfTags('balkan', [{ name: 'serbian', count: 100 }, { name: 'rock', count: 60 }, { name: 'new wave', count: 30 }])).toBe('balkan-rock');
    expect(subOfTags('balkan', [{ name: 'serbian rap', count: 100 }])).toBe('balkan-hiphop');
    expect(subOfTags('balkan', [{ name: 'serbian', count: 100 }])).toBeNull();
  });

  it('no family, a chart prior or nothing matching is no sub-genre', () => {
    expect(subOfTags(null, [{ name: 'rock', count: 1 }])).toBeNull();
    expect(subOfTags('rock-metal', [{ name: 'chart:hard-rock-metal', count: 1 }])).toBeNull();
    expect(subOfTags('pop', [{ name: 'pop', count: 100 }])).toBeNull();
  });

  it('classifyTags reports the sub-genre with the family', () => {
    expect(classifyTags([{ name: 'electronic', count: 100 }, { name: 'techno', count: 60 }])).toMatchObject({ family: 'electronic', sub: 'techno' });
  });
});
