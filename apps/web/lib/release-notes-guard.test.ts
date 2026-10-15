import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG } from './changelog';

const BANNED = /prank|joke/i;

describe('release notes stay clean of internal features', () => {
  it('the in-app changelog has no banned wording', () => {
    expect(BANNED.test(JSON.stringify(CHANGELOG))).toBe(false);
  });

  it('changelog.ts source has no banned wording', () => {
    const src = readFileSync(resolve(__dirname, 'changelog.ts'), 'utf8');
    expect(BANNED.test(src)).toBe(false);
  });

  it('UPDATE_NOTES.md has no banned wording', () => {
    const notes = readFileSync(resolve(__dirname, '../../../UPDATE_NOTES.md'), 'utf8');
    expect(BANNED.test(notes)).toBe(false);
  });
});
