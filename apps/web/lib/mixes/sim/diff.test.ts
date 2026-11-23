import { describe, expect, it } from 'vitest';
import { diffRuns, formatDiff } from './diff';
import type { SimMember, SimRun, SimTrack } from './types';

const t = (k: string, over: Partial<SimTrack> = {}): SimTrack => ({
  id: `youtube:${k}`, songKey: k, title: `Song ${k}`, artist: `Artist ${k}`, artistKey: k, own: false,
  source: 'musicbrainz', family: 'pop', tags: [], untagged: false, ...over,
});

const member = (userId: string, mixes: Record<string, SimTrack[]>, over: Partial<SimMember> = {}): SimMember => ({
  userId, eligible: true, written: Object.keys(mixes), kept: [], deleted: [],
  mixes: Object.entries(mixes).map(([key, tracks], position) => ({ key, title: key, position, tracks })),
  plans: [], families: {}, unrecognised: [], notes: [], radioMissing: [], ...over,
});

const run = (label: string, members: SimMember[]): SimRun => ({ label, createdAt: '', now: '', members });

describe('diffRuns', () => {
  it('a run against itself has no moves and no appear / disappear', () => {
    const r = run('a', [member('u1', { pop: [t('a'), t('b')], rock: [t('c')] })]);
    const d = diffRuns(r, r);
    expect(d.members[0].appeared).toEqual([]);
    expect(d.members[0].disappeared).toEqual([]);
    for (const m of d.members[0].mixes) {
      expect(m.movedOut).toEqual([]);
      expect(m.added).toEqual([]);
    }
  });

  it('says where a moved song went and where an added song came from', () => {
    const before = run('before', [member('u1', { pop: [t('a'), t('ost', { untagged: true })], rock: [t('c')] })]);
    const after = run('after', [member('u1', { pop: [t('a'), t('n')], rock: [t('c')], 'game-anime': [t('ost', { untagged: true, signal: 'strong' })] })]);
    const d = diffRuns(before, after).members[0];
    expect(d.appeared).toEqual(['game-anime']);
    const pop = d.mixes.find((m) => m.key === 'pop')!;
    expect(pop.movedOut.map((s) => [s.songKey, s.to])).toEqual([['ost', ['game-anime']]]);
    expect(pop.added.map((s) => [s.songKey, s.from])).toEqual([['n', []]]);
    expect(pop.untaggedBefore).toBe(1);
    expect(pop.untaggedAfter).toBe(0);
    const ga = d.mixes.find((m) => m.key === 'game-anime')!;
    expect(ga.before).toBeNull();
    expect(ga.after).toBe(1);
    expect(d.gameAnime).toEqual({ before: null, after: 1 });
    expect(d.gameAnimeOwn).toBeNull();
    const withOwn = diffRuns(before, run('after', [member('u1', {}, { families: { 'game-anime': { weight: 2, songs: 1, artists: 1 } } })]));
    expect(formatDiff(withOwn)).toContain('own Game & Anime songs: 1 by 1 artist(s), weight 2');
  });

  it('a song moved to no mix goes "nowhere", a dropped mix is listed', () => {
    const before = run('before', [member('u1', { pop: [t('a'), t('x')], latin: [t('l')] })]);
    const after = run('after', [member('u1', { pop: [t('a')] })]);
    const d = diffRuns(before, after).members[0];
    expect(d.disappeared).toEqual(['latin']);
    expect(d.mixes.find((m) => m.key === 'pop')!.movedOut[0].to).toEqual([]);
    expect(formatDiff(diffRuns(before, after))).toContain('"Song x" by Artist x -> nowhere');
  });

  it('flags a song the title rule sends to Game & Anime in another style mix, not in other kinds', () => {
    const after = run('after', [member('u1', {
      pop: [t('s', { signal: 'weak', untagged: true }), t('tagged', { signal: 'weak' }), t('admin', { signal: 'strong', source: 'manual' })],
      'game-anime': [t('g', { signal: 'strong' })],
      discover: [t('d', { signal: 'strong' })],
      'artist-noah': [t('n', { signal: 'strong' })],
    })]);
    const d = diffRuns(run('before', []), after).members[0];
    expect(d.flagged.map((f) => [f.mix, f.songKey])).toEqual([['pop', 's']]);
    expect(formatDiff(diffRuns(run('before', []), after))).toContain('flagged 1 (before: 0)');
    expect(diffRuns(after, after).members[0].flaggedBefore).toBe(1);
  });

  it('a member only in one run shows every mix as appeared or disappeared', () => {
    const d = diffRuns(run('a', [member('u1', { pop: [t('a')] })]), run('b', [member('u2', { rock: [t('r')] })]));
    expect(d.members.map((m) => [m.userId, m.appeared, m.disappeared])).toEqual([['u1', [], ['pop']], ['u2', ['rock'], []]]);
  });
});
