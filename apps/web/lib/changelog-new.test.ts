import { describe, expect, it } from 'vitest';
import { computeNewIds, type ChangelogEntry } from './changelog';

function entry(id: string, version: string): ChangelogEntry {
  return { id, version, date: '2026-09-18', title: id, summary: id, bullets: [id] };
}

const entries = [
  entry('e', '0.3.4'),
  entry('d', '0.3.3'),
  entry('c', '0.3.1'),
  entry('b', '0.3.0'),
  entry('a', '0.2.4'),
];

describe('computeNewIds', () => {
  it('empty or missing seen (new user, not loaded yet) shows nothing as New', () => {
    expect(computeNewIds(entries, '', false)).toEqual([]);
    expect(computeNewIds(entries, null, false)).toEqual([]);
    expect(computeNewIds(entries, undefined, false)).toEqual([]);
  });

  it('seen equal to the current version shows nothing as New', () => {
    expect(computeNewIds(entries, '0.3.4', false)).toEqual([]);
  });

  it('marks only the entries above seen', () => {
    expect(computeNewIds(entries, '0.3.3', false)).toEqual(['e']);
  });

  it('a user who skipped versions sees every entry above seen as New', () => {
    expect(computeNewIds(entries, '0.3.0', false)).toEqual(['e', 'd', 'c']);
    expect(computeNewIds(entries, '0.1.0', false)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('several entries in one version are New together', () => {
    const same = [entry('x', '0.3.0'), entry('y', '0.3.0'), entry('z', '0.2.4')];
    expect(computeNewIds(same, '0.2.4', false)).toEqual(['x', 'y']);
  });

  it('hideNew empties the set', () => {
    expect(computeNewIds(entries, '0.1.0', true)).toEqual([]);
  });

  it('a seen version newer than every entry shows nothing', () => {
    expect(computeNewIds(entries, '9.0.0', false)).toEqual([]);
  });
});
