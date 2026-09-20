import { describe, expect, it } from 'vitest';
import { shouldScroll } from './MarqueeText';

/** The marquee's whole decision is "is this title wider than its box", and
 *  the bug this guards against is that decision changing on every measure.
 *  `shouldScroll` is sticky inside a band around the threshold, so feeding
 *  it measurements that straddle the edge has to settle, not flip. */
describe('MarqueeText / shouldScroll', () => {
  it('leaves a title that fits alone', () => {
    expect(shouldScroll(false, 120, 300)).toBe(false);
  });

  it('starts scrolling a title that overruns its box', () => {
    expect(shouldScroll(false, 400, 200)).toBe(true);
  });

  it('goes static again once the box is comfortably wide enough', () => {
    expect(shouldScroll(true, 200, 400)).toBe(false);
  });

  it('keeps the previous answer until anything has been laid out', () => {
    // A closed view measures 0 by 0: that is "no information", not "fits".
    expect(shouldScroll(true, 0, 300)).toBe(true);
    expect(shouldScroll(true, 220, 0)).toBe(true);
    expect(shouldScroll(false, 0, 0)).toBe(false);
  });

  it('does not start on a title that only just reaches the edge', () => {
    expect(shouldScroll(false, 300, 300)).toBe(false);
    expect(shouldScroll(false, 303, 300)).toBe(false);
  });

  it('does not stop on a scrolling title that only just fits', () => {
    expect(shouldScroll(true, 300, 300)).toBe(true);
    expect(shouldScroll(true, 295, 300)).toBe(true);
  });

  it('settles instead of oscillating when measurements straddle the threshold', () => {
    // The regression looked like this: the box width measured differently
    // depending on whether the marquee was animating, so each measure
    // flipped the answer and the title strobed. Alternating measurements
    // must reach a fixed point within one step, from either start.
    const straddling: Array<[number, number]> = [
      [302, 300], [298, 300], [300, 300], [301, 299], [299, 301],
    ];
    for (const start of [false, true]) {
      let state = start;
      const seen: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        const [textWidth, available] = straddling[i % straddling.length];
        state = shouldScroll(state, textWidth, available);
        seen.push(state);
      }
      // After the first step the answer never changes again.
      expect(new Set(seen.slice(1)).size).toBe(1);
      expect(state).toBe(start);
    }
  });

  it('still flips when the width genuinely changes', () => {
    let state = shouldScroll(false, 500, 200);
    expect(state).toBe(true);
    state = shouldScroll(state, 500, 900);
    expect(state).toBe(false);
    state = shouldScroll(state, 500, 200);
    expect(state).toBe(true);
  });
});
