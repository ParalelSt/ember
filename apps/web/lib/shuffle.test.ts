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
    // Fisher-Yates: iterate i from end to 1, pick j = floor(rng()*(i+1)), swap result[i] <-> result[j]
    // With rng()=0: j always 0, so each iteration swaps result[i] with result[0]
    // i=4: [5,2,3,4,1], i=3: [4,2,3,5,1], i=2: [3,2,4,5,1], i=1: [2,3,4,5,1]
    const rng = () => 0;
    expect(shuffle(input, rng)).toEqual([2, 3, 4, 5, 1]);
  });

  it('handles an empty list', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles a single-element list', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});
