import { describe, expect, it } from 'vitest';
import { clockJumped, planClicks, playClick, type ClickAudio } from './metronome';

const beats = (...at: number[]) => at.map((a, i) => ({ at: a, accent: i === 0 }));

describe('planning the clicks', () => {
  it('schedules the beats ahead, each once, with the delay in real time', () => {
    const first = planClicks(beats(10, 10.1, 10.5), 9.95, 1, -Infinity);
    expect(first.clicks.map((c) => [c.at, Number(c.delay.toFixed(3)), c.accent])).toEqual([
      [10, 0.05, true],
      [10.1, 0.15, false],
      [10.5, 0.55, false],
    ]);
    expect(first.last).toBe(10.5);
    // The next look ahead overlaps: nothing twice.
    expect(planClicks(beats(10.1, 10.5), 10.05, 1, first.last).clicks).toEqual([]);
  });

  it('at half speed a beat is twice as far away', () => {
    const { clicks } = planClicks(beats(20.1), 20, 0.5, -Infinity);
    expect(clicks[0].delay).toBeCloseTo(0.2);
  });

  it('a beat already gone is dropped, one a few ms late sounds at once', () => {
    const { clicks } = planClicks(beats(4.9, 4.99), 5, 1, -Infinity);
    expect(clicks.map((c) => [c.at, c.delay])).toEqual([[4.99, 0]]);
  });

  it('sorts what it is handed', () => {
    expect(planClicks(beats(3, 1, 2), 0.9, 1, -Infinity).clicks.map((c) => c.at)).toEqual([1, 2, 3]);
  });
});

describe('noticing a seek', () => {
  it('a playhead running on is not a jump; one moved is', () => {
    expect(clockJumped(null, 1, 0, 1)).toBe(true);
    expect(clockJumped({ sec: 10, at: 1000 }, 10.1, 1100, 1)).toBe(false);
    expect(clockJumped({ sec: 10, at: 1000 }, 10.05, 1100, 0.5)).toBe(false);
    expect(clockJumped({ sec: 10, at: 1000 }, 4, 1100, 1)).toBe(true);
    expect(clockJumped({ sec: 10, at: 1000 }, 10.6, 1100, 1)).toBe(true);
  });
});

describe('the click', () => {
  function fakeCtx(now = 1) {
    const log: string[] = [];
    const ctx: ClickAudio = {
      currentTime: now,
      destination: 'out',
      createOscillator: () => ({
        frequency: { value: 0 },
        type: '',
        connect: () => log.push('osc>gain'),
        start(t: number) {
          log.push(`start ${t} ${this.frequency.value} ${this.type}`);
        },
        stop: (t: number) => log.push(`stop ${t}`),
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: (v: number, t: number) => log.push(`gain ${v} @${t}`),
          exponentialRampToValueAtTime: (v: number, t: number) => log.push(`ramp ${v} @${t}`),
        },
        connect: (n: unknown) => log.push(`gain>${String(n)}`),
      }),
    };
    return { ctx, log };
  }

  it('an accent is higher and louder, and is never scheduled in the past', () => {
    const { ctx, log } = fakeCtx(2);
    playClick(ctx, 2.5, true, 0.5);
    playClick(ctx, 1, false, 0.5);
    expect(log.filter((l) => l.startsWith('start'))).toEqual(['start 2.5 1760 square', 'start 2 1320 square']);
    expect(log.filter((l) => l.startsWith('gain '))).toEqual(['gain 0.5 @2.5', 'gain 0.3 @2']);
    expect(log).toContain('gain>out');
  });
});
