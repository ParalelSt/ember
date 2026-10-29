import { afterEach, describe, expect, it, vi } from 'vitest';
import { coarsePointer } from './coarsePointer';

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe('coarsePointer', () => {
  it('follows the (pointer: coarse) media query', () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q === '(pointer: coarse)' }) as MediaQueryList);
    expect(coarsePointer()).toBe(true);
    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
    expect(coarsePointer()).toBe(false);
  });

  it('is false without matchMedia', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(coarsePointer()).toBe(false);
  });
});
