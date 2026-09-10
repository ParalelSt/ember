import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes, formatCount, formatTime, formatTotalDuration } from './format';

describe('formatTime', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(61)).toBe('1:01');
  });

  it('floors past an hour instead of resetting minutes', () => {
    expect(formatTime(3599)).toBe('59:59');
    expect(formatTime(3600)).toBe('60:00');
    expect(formatTime(3661)).toBe('61:01');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(90.9)).toBe('1:30');
  });

  it('falls back to the default empty value for non-finite, nullish or negative input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime(null)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });

  it('uses the provided empty value', () => {
    expect(formatTime(undefined, { empty: '--:--' })).toBe('--:--');
    expect(formatTime(NaN, { empty: '' })).toBe('');
    expect(formatTime(-1, { empty: '--:--' })).toBe('--:--');
  });
});

describe('formatTotalDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatTotalDuration(125)).toBe('2:05');
  });

  it('formats over an hour as Nh Mm', () => {
    expect(formatTotalDuration(4320)).toBe('1h 12m');
  });

  it('formats exactly an hour as Nh Mm', () => {
    expect(formatTotalDuration(3600)).toBe('1h 0m');
  });

  it('returns empty string for falsy or non-finite input', () => {
    expect(formatTotalDuration(0)).toBe('');
    expect(formatTotalDuration(NaN)).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats gigabytes with two decimals', () => {
    expect(formatBytes(2.25 * 1024 * 1024 * 1024)).toBe('2.25 GB');
  });
});

describe('formatCount', () => {
  it('pluralizes with a trailing s by default', () => {
    expect(formatCount(0, 'song')).toBe('0 songs');
    expect(formatCount(2, 'song')).toBe('2 songs');
  });

  it('keeps the noun singular for 1', () => {
    expect(formatCount(1, 'track')).toBe('1 track');
  });

  it('uses an explicit irregular plural', () => {
    expect(formatCount(0, 'pin', 'pins')).toBe('0 pins');
    expect(formatCount(1, 'pin', 'pins')).toBe('1 pin');
    expect(formatCount(3, 'pin', 'pins')).toBe('3 pins');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-01-01T12:00:00Z').getTime();

  it('reports "now" for under thirty seconds (rounds to 0 minutes)', () => {
    expect(formatAgo(new Date(now - 20_000).toISOString(), now)).toBe('now');
  });

  it('uses singular for exactly one minute', () => {
    expect(formatAgo(new Date(now - 60_000).toISOString(), now)).toBe('1 min ago');
  });

  it('uses plural minutes, uncapped (no hour/day buckets, matching the ported source)', () => {
    expect(formatAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(formatAgo(new Date(now - 120 * 60_000).toISOString(), now)).toBe('120 min ago');
    expect(formatAgo(new Date(now - 2 * 24 * 60 * 60_000).toISOString(), now)).toBe('2880 min ago');
  });

  it('defaults `now` to the current time when omitted', () => {
    const iso = new Date(Date.now() - 20_000).toISOString();
    expect(formatAgo(iso)).toBe('now');
  });
});
