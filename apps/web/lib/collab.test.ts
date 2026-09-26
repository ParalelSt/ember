import { describe, expect, it } from 'vitest';
import { inviteUrl, isInviteCode, isRecordId, moveItem, publicName } from './collab';

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
