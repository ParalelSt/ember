import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('show-password eye on Windows', () => {
  const css = readFileSync(join(__dirname, '../globals.css'), 'utf8');
  it('is painted white', () => {
    const rule = css.split('\n').find((l) => l.includes('::-ms-reveal'));
    expect(rule).toBeDefined();
    expect(rule).toContain('brightness(0) invert(1)');
  });
});
