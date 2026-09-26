import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTrackGain = vi.fn<(id: string) => Promise<{ gainDb: number | null }>>();
vi.mock('@/lib/api', () => ({ api: { getTrackGain: (id: string) => getTrackGain(id) } }));

const { dbToLinear, cachedTrackGain, loadTrackGain, resetTrackGainsForTests } = await import('./normalization');

const YT = 'youtube:abcdefghijk';

beforeEach(() => {
  window.localStorage.clear();
  resetTrackGainsForTests();
  getTrackGain.mockReset();
});

describe('dbToLinear', () => {
  it('turns dB into an amplitude multiplier', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-3)).toBeCloseTo(0.708, 3);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 3);
  });

  it('clamps to -5..+6 dB (never more than a few dB down) and treats garbage as unchanged', () => {
    expect(dbToLinear(-40)).toBeCloseTo(dbToLinear(-5), 10);
    expect(dbToLinear(-12)).toBeCloseTo(0.562, 3);
    expect(dbToLinear(30)).toBeCloseTo(dbToLinear(6), 10);
    expect(dbToLinear(null)).toBe(1);
    expect(dbToLinear(undefined)).toBe(1);
    expect(dbToLinear(Number.NaN)).toBe(1);
  });
});

describe('loadTrackGain', () => {
  it('fetches once, caches the gain, and keeps it across a reload', async () => {
    getTrackGain.mockResolvedValue({ gainDb: -5.5 });
    const [a, b] = await Promise.all([loadTrackGain(YT), loadTrackGain(YT)]);
    expect(a).toBe(-5.5);
    expect(b).toBe(-5.5);
    expect(getTrackGain).toHaveBeenCalledTimes(1);
    expect(cachedTrackGain(YT)).toBe(-5.5);
    expect(await loadTrackGain(YT)).toBe(-5.5);
    expect(getTrackGain).toHaveBeenCalledTimes(1);

    // A new page load reads it back from storage.
    resetTrackGainsForTests();
    expect(cachedTrackGain(YT)).toBe(-5.5);
  });

  it('does not cache "not measured yet": the next ask goes to the server again', async () => {
    getTrackGain.mockResolvedValueOnce({ gainDb: null }).mockResolvedValueOnce({ gainDb: 1.5 });
    expect(await loadTrackGain(YT)).toBeNull();
    expect(cachedTrackGain(YT)).toBeUndefined();
    expect(await loadTrackGain(YT)).toBe(1.5);
    expect(getTrackGain).toHaveBeenCalledTimes(2);
  });

  it('a failed request (offline) is null, never a throw', async () => {
    getTrackGain.mockRejectedValue(new Error('offline'));
    expect(await loadTrackGain(YT)).toBeNull();
  });

  it('never asks about uploads or empty ids', async () => {
    expect(await loadTrackGain('upload:xyz')).toBeNull();
    expect(await loadTrackGain(null)).toBeNull();
    expect(getTrackGain).not.toHaveBeenCalled();
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem('ember.trackGains.v2', '{nope');
    expect(cachedTrackGain(YT)).toBeUndefined();
  });

  it('forgets gains stored under the old -14 LUFS policy, and asks again', async () => {
    // What 0.7.10..0.7.13 left behind: this song cut by 6 dB, for good.
    window.localStorage.setItem('ember.trackGains.v1', JSON.stringify({ [YT]: -6 }));
    expect(cachedTrackGain(YT)).toBeUndefined();
    expect(window.localStorage.getItem('ember.trackGains.v1')).toBeNull();
    getTrackGain.mockResolvedValue({ gainDb: -1 });
    expect(await loadTrackGain(YT)).toBe(-1);
    expect(JSON.parse(window.localStorage.getItem('ember.trackGains.v2')!)).toEqual({ [YT]: -1 });
  });
});
