import { describe, expect, it } from 'vitest';
import { chipPeople, planMoves, inviteUrl, isInviteCode, isRecordId, moveItem, publicName, type CollabState } from './collab';

describe('isInviteCode', () => {
  it('takes 32 base64url characters and nothing else', () => {
    expect(isInviteCode('abcdefghijklmnopqrstuvwxyzAB-_09')).toBe(true);
    for (const bad of ['', 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}"`, `${'a'.repeat(31)} `, null, 42, { a: 1 }]) {
      expect(isInviteCode(bad)).toBe(false);
    }
  });
});

describe('isRecordId', () => {
  it('letters and digits only, so nothing can change a filter', () => {
    expect(isRecordId('abc123def456ghi')).toBe(true);
    for (const bad of ['', 'a"b', 'a b', 'a||b', '../x', 'x'.repeat(65), undefined]) {
      expect(isRecordId(bad)).toBe(false);
    }
  });
});

describe('publicName', () => {
  it('is the chosen name, never anything from the email', () => {
    expect(publicName({ name: '  Mia ' })).toBe('Mia');
    expect(publicName({ name: '', email: 'mia@ember.test' } as { name: string })).toBe('Unnamed member');
    expect(publicName(null)).toBe('Unnamed member');
  });
});

describe('inviteUrl', () => {
  it('builds the join page link on this origin', () => {
    expect(inviteUrl('https://ember.example/', 'c'.repeat(32))).toBe(`https://ember.example/playlist/join/${'c'.repeat(32)}`);
  });
});

describe('moveItem', () => {
  it('moves one item and leaves the input alone', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect(moveItem(input, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps the target and ignores a missing source', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('chipPeople', () => {
  const me = { name: 'Olga', avatarUrl: null };
  const mia = { id: 'mia', name: 'Mia', avatarUrl: null };
  const state = (patch: Partial<CollabState> = {}): CollabState => ({
    collaborative: true,
    role: 'owner',
    owner: { id: 'olga', ...me },
    members: [mia],
    maxMembers: 50,
    inviteCode: null,
    ...patch,
  });

  it('a private playlist, or one whose people have not loaded: just you', () => {
    expect(chipPeople(false, state(), me)).toEqual([me]);
    expect(chipPeople(true, undefined, me)).toEqual([me]);
  });

  it('shared: the owner first, then everyone on it', () => {
    expect(chipPeople(true, state(), me).map((p) => p.name)).toEqual(['Olga', 'Mia']);
  });

  it('turned off with people kept for next time: just you, nobody else can edit', () => {
    expect(chipPeople(true, state({ collaborative: false }), me)).toEqual([me]);
  });
});

describe('planMoves (Edit order: Done)', () => {
  const apply = (from: string[], moves: { trackId: string; to: number }[]) =>
    moves.reduce((list, m) => moveItem(list, list.indexOf(m.trackId), m.to), from);

  it('nothing moved: nothing to send', () => {
    expect(planMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('one song moved anywhere is one request', () => {
    expect(planMoves(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c'])).toEqual([{ trackId: 'd', to: 0 }]);
    expect(planMoves(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])).toEqual([{ trackId: 'a', to: 3 }]);
    expect(planMoves(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])).toHaveLength(1);
  });

  it('any shuffle comes out right, in as few moves as songs out of place', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 300; n++) {
      const len = 1 + Math.floor(rand() * 12);
      const from = Array.from({ length: len }, (_, i) => `t${i}`);
      const to = [...from].sort(() => rand() - 0.5);
      const moves = planMoves(from, to);
      expect(apply(from, moves)).toEqual(to);
      expect(moves.length).toBeLessThan(len);
    }
  });

  it('lists that do not hold the same songs: nothing (the caller lines them up first)', () => {
    expect(planMoves(['a', 'b'], ['b', 'c'])).toEqual([]);
  });
});
