import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPACING_SCALE } from './spacing';

// Restated here on purpose: this test pins
// the spec's numbers, so a token (or the gallery's table) drifting from
// them fails instead of silently redefining the scale.
const SPEC: Record<string, number> = {
  inset: 4,
  cluster: 8,
  row: 12,
  block: 16,
  stack: 24,
  section: 40,
  page: 24,
  'page-lg': 32,
  hit: 40,
};

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

function tokenRem(name: string): number | null {
  const match = css.match(new RegExp(`--spacing-${name}:\\s*([\\d.]+)rem;`));
  return match ? Number(match[1]) : null;
}

describe('spacing scale', () => {
  for (const [name, px] of Object.entries(SPEC)) {
    it(`globals.css defines --spacing-${name} as ${px}px`, () => {
      expect(tokenRem(name), `--spacing-${name} missing from globals.css`).not.toBeNull();
      expect(tokenRem(name)! * 16).toBe(px);
    });
  }

  it('the gallery table lists exactly the spec tokens with the same values', () => {
    expect(Object.fromEntries(SPACING_SCALE.map((s) => [s.name, s.px]))).toEqual(SPEC);
    for (const s of SPACING_SCALE) expect(s.ruler).toBe(`w-${s.name}`);
  });

  it('text-hero-title carries no spacing of its own (the parent spaces it)', () => {
    const block = css.match(/@utility text-hero-title \{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block![1]).not.toMatch(/\b(m[tbxy]?|p[tbxy]?)-/);
  });
});
