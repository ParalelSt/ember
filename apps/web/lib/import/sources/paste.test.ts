import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_PASTE_LINE_CHARS, MAX_PASTE_LINES, parsePaste } from '@/lib/import/sources/paste';
import { isParseError } from '@/lib/import/sources/types';

const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/imports/transfer');

function parse(text: string) {
  const r = parsePaste(text);
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

describe('parsePaste', () => {
  it('reads every shape in the fixture, in the order they were pasted', () => {
    const r = parse(readFileSync(path.join(FIXTURES, 'paste.sample.txt'), 'utf8'));
    expect(r.items.map((i) => [i.artist, i.title])).toEqual([
      ['Artist', 'Title'],
      ['Halcyon Drift', 'Paper Lanterns'],
      ['Nadia Okonkwo', 'Slow Weather'],
      ['The Quiet Parade', 'Nine Streets (Live)'],
      ['Mirror Hall', 'Cold Open'],
      ['', 'Fjord, at Dawn'],
      ['Halcyon Drift', 'Paper Lanterns'],
    ]);
  });

  it('a hyphen, an en dash and an em dash all separate the artist from the song', () => {
    expect(parse('A - B\nA – B\nA — B').items.every((i) => i.artist === 'A' && i.title === 'B')).toBe(true);
  });

  it('a song whose own name has a dash keeps it', () => {
    expect(parse('Halcyon Drift - Paper Lanterns - Live').items[0]).toMatchObject({
      artist: 'Halcyon Drift',
      title: 'Paper Lanterns - Live',
    });
  });

  it('"Title by Artist" is read the other way round', () => {
    expect(parse('Cold Open by Mirror Hall').items[0]).toMatchObject({ artist: 'Mirror Hall', title: 'Cold Open' });
  });

  it('a line with no separator at all is searched on its own', () => {
    expect(parse('Paper Lanterns').items[0]).toMatchObject({ artist: '', artists: [], title: 'Paper Lanterns' });
  });

  it('numbering in front and a length at the end are stripped', () => {
    const r = parse('3. A - B 3:45\n4) C - D [1:02:03]\n5] E - F (2:10)');
    expect(r.items.map((i) => i.title)).toEqual(['B', 'D', 'F']);
  });

  it('blank lines are skipped without counting as dropped', () => {
    const r = parse('A - B\n\n   \n\nC - D');
    expect(r.items).toHaveLength(2);
    expect(r.dropped).toBe(0);
  });

  it('nothing is carried over about when a song was liked', () => {
    expect(parse('A - B').items[0].likedAt).toBeNull();
    expect(parse('A - B').order).toBe('newest-first');
  });

  it('a line that runs on forever is cut to a sane length', () => {
    const long = 'x'.repeat(MAX_PASTE_LINE_CHARS + 200);
    expect(parse(long).items[0].title.length).toBeLessThanOrEqual(MAX_PASTE_LINE_CHARS);
  });

  it('stops at the line cap', () => {
    const many = Array.from({ length: MAX_PASTE_LINES + 500 }, (_, i) => `A${i} - B${i}`).join('\n');
    expect(parse(many).items).toHaveLength(MAX_PASTE_LINES);
  });

  it('a paste with no songs in it says what to do instead', () => {
    const r = parsePaste('   \n\n  ');
    expect(isParseError(r)).toBe(true);
    expect((r as { error: string }).error).toContain('Artist - Title');
  });
});
