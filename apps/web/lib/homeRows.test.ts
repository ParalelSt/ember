import { describe, expect, it } from 'vitest';
import { fitCount, homeRowHref } from './homeRows';

describe('fitCount: whole cards in one line', () => {
  it('counts like CSS auto-fill', () => {
    expect(fitCount(1000, 180, 16)).toBe(5); // 5*180 + 4*16 = 964
    expect(fitCount(964, 180, 16)).toBe(5);
    expect(fitCount(963, 180, 16)).toBe(4);
    expect(fitCount(100, 180, 16)).toBe(1);
  });

  it('is 0 while the width is unknown', () => {
    expect(fitCount(0, 180, 16)).toBe(0);
  });
});

describe('homeRowHref', () => {
  it('points at the full grid of one row', () => {
    expect(homeRowHref('history')).toBe('/?row=history');
  });
});
