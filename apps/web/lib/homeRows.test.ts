import { describe, expect, it } from 'vitest';
import { fitCount, homeRowHref, pageTarget, parseHomeRowsVariant, pickHomeRowsVariant } from './homeRows';

// Ten 180px cards 16px apart: lefts 0, 196, 392, 588, 784, ... 1764.
const cards = Array.from({ length: 10 }, (_, i) => ({ left: i * 196, width: 180 }));
const scrollWidth = 9 * 196 + 180; // 1944

describe('the ?homerows switch', () => {
  it('knows the four variants and today, in any case', () => {
    for (const v of ['a', 'b', 'c', 'd', 'today'] as const) expect(parseHomeRowsVariant(v)).toBe(v);
    expect(parseHomeRowsVariant(' B ')).toBe('b');
    expect(parseHomeRowsVariant('e')).toBeNull();
    expect(parseHomeRowsVariant(null)).toBeNull();
  });

  it('takes the param first, then the saved pick, then today', () => {
    expect(pickHomeRowsVariant('a', 'c')).toBe('a');
    expect(pickHomeRowsVariant(null, 'c')).toBe('c');
    expect(pickHomeRowsVariant('nope', 'd')).toBe('d');
    expect(pickHomeRowsVariant(null, null)).toBe('today');
    expect(pickHomeRowsVariant(null, 'junk')).toBe('today');
  });
});

describe('pageTarget: one press moves a screen of whole cards', () => {
  it('forward puts the first card not wholly in view at the left edge', () => {
    // 700px shows cards 0-2 whole (card 3 ends at 768).
    expect(pageTarget(cards, 0, 700, scrollWidth, 1)).toBe(588);
  });

  it('forward from a half-scrolled row still lands on a card edge', () => {
    // At 250 card 1 is cut at the left; card 4 (784..964) is cut at 950.
    expect(pageTarget(cards, 250, 700, scrollWidth, 1)).toBe(784);
  });

  it('forward never passes the end', () => {
    expect(pageTarget(cards, 1176, 700, scrollWidth, 1)).toBe(scrollWidth - 700);
  });

  it('back brings the card before the first one in view in as the last whole card', () => {
    // First in view at 460 is card 3 (588); card 2 ends at 572, so the new
    // left is the first card edge at or past 572 - 700 = -128: 0.
    expect(pageTarget(cards, 460, 700, scrollWidth, -1)).toBe(0);
    // From 784, card 3 (588..768) must end in view: first edge >= 68 is 196.
    expect(pageTarget(cards, 784, 700, scrollWidth, -1)).toBe(196);
  });

  it('back from the start stays at 0', () => {
    expect(pageTarget(cards, 0, 700, scrollWidth, -1)).toBe(0);
  });

  it('a press always moves the row the way it points (or not at all at an end)', () => {
    for (let left = 0; left <= scrollWidth - 700; left += 37) {
      expect(pageTarget(cards, left, 700, scrollWidth, 1)).toBeGreaterThanOrEqual(left);
      expect(pageTarget(cards, left, 700, scrollWidth, -1)).toBeLessThanOrEqual(left);
    }
  });
});

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
  it('points at variant C\'s full grid of one row', () => {
    expect(homeRowHref('history')).toBe('/?homerows=c&row=history');
  });
});
