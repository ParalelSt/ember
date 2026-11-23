import { describe, expect, it } from 'vitest';
import { perfLine, sanitizePerfBlock } from './reportBlock';
import type { PerfBlock } from './types';

describe('sanitizePerfBlock', () => {
  it('keeps numbers and short scrubbed strings, caps lists and drops functions and deep nesting', () => {
    const out = sanitizePerfBlock({
      on: true,
      note: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      list: Array.from({ length: 50 }, (_, i) => i),
      deep: { a: { b: { c: { d: { e: { f: 1 } } } } } },
      fn: () => 1,
      nan: Number.NaN,
    }) as unknown as Record<string, unknown>;
    expect(out.on).toBe(true);
    expect(String(out.note)).not.toContain('abcdefghijklmnop');
    expect((out.list as number[]).length).toBe(30);
    expect((out.list as number[])[0]).toBe(20);
    expect(JSON.stringify(out.deep)).not.toContain('"f"');
    expect('fn' in out).toBe(false);
    expect('nan' in out).toBe(false);
  });

  it('refuses non-objects', () => {
    expect(sanitizePerfBlock(null)).toBeUndefined();
    expect(sanitizePerfBlock([1])).toBeUndefined();
    expect(sanitizePerfBlock('x')).toBeUndefined();
  });
});

describe('perfLine', () => {
  it('says when the perf log was off, and when there is nothing yet', () => {
    expect(perfLine({ on: false, off: 'host' } as PerfBlock)).toBe('perf log off (host)');
    expect(perfLine({ on: true } as PerfBlock)).toBe('no perf numbers yet');
  });
});
