import { describe, expect, it } from 'vitest';
import { shuffle } from './shuffle';

describe('shuffle', () => {
  it('returns a new array', () => {
    const input = [1, 2, 3];
    const result = shuffle(input);
    expect(result).not.toBe(input);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    shuffle(input, () => 0.5);
    expect(input).toEqual(copy);
  });

  it('is a permutation of the same multiset', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffle(input, () => 0.9);
    expect(result.slice().sort()).toEqual(input.slice().sort());
    expect(result).toHaveLength(input.length);
  });

  it('is deterministic given a seeded rng', () => {
    const input = [1, 2, 3, 4, 5];
    const rng = () => 0; // always picks index 0 -> no swaps ever happen at j
    const a = shuffle(input, rng);
    const b = shuffle(input, rng);
    expect(a).toEqual(b);
  });

  it('handles an empty list', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles a single-element list', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});
