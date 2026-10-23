import { describe, expect, it } from 'vitest';
import { escapeFilterValue } from './filterValue';

describe('escapeFilterValue', () => {
  it('leaves plain text alone', () => {
    expect(escapeFilterValue('youtube:abc_123')).toBe('youtube:abc_123');
  });

  it('escapes quotes so text cannot close the string', () => {
    expect(escapeFilterValue('a" || id != "')).toBe('a\\" || id != \\"');
  });

  it('escapes backslashes first, so an escaped quote stays escaped', () => {
    expect(escapeFilterValue('a\\"b')).toBe('a\\\\\\"b');
    expect(escapeFilterValue('\\')).toBe('\\\\');
  });
});
