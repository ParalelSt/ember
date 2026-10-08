import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, formatCode, isCode, normalizeCode } from './codes';

describe('the short code alphabet', () => {
  it('is Crockford base32: 32 symbols, no I, L, O or U', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const banned of ['I', 'L', 'O', 'U']) expect(CODE_ALPHABET).not.toContain(banned);
    expect(CODE_LENGTH).toBe(8);
  });
});

describe('normalizeCode', () => {
  it.each([
    ['ABCD-EFGH', 'ABCDEFGH'],
    ['abcd-efgh', 'ABCDEFGH'],
    ['  ab cd ef gh ', 'ABCDEFGH'],
    ['ABCD–EFGH', 'ABCDEFGH'],
    ['0O0O-1IL1', '00001111'],
    ['oooo-iiii', '00001111'],
    ['llll-0000', '11110000'],
    ['7K3M-9QZX', '7K3M9QZX'],
  ])('%s -> %s', (input, want) => {
    expect(normalizeCode(input)).toBe(want);
  });

  it.each([
    ['too short', 'ABCD-EFG'],
    ['too long', 'ABCD-EFGHJ'],
    ['U is not in the alphabet', 'ABCD-EFGU'],
    ['punctuation', 'ABCD-EF!H'],
    ['empty', ''],
    ['a link instead of a code', 'https://x/link/abc'],
  ])('refuses %s', (_label, input) => {
    expect(normalizeCode(input)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 12345678, {}, ['ABCDEFGH']]) expect(normalizeCode(v)).toBeNull();
  });
});

describe('formatCode', () => {
  it('groups the code in two blocks of four', () => {
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('isCode', () => {
  it('accepts only an already-normalised code', () => {
    expect(isCode('ABCDEFGH')).toBe(true);
    expect(isCode('ABCD-EFGH')).toBe(false);
    expect(isCode('abcdefgh')).toBe(false);
    expect(isCode('ABCDEFGU')).toBe(false);
  });
});
