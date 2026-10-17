import { describe, expect, it } from 'vitest';
import { UNCLEAN_GAP_MS, fmtDuration, judgePreviousRun, parseHeartbeat } from './serverLife';

const hb = (o: object = {}) => ({ ts: 1_000_000, startedAt: 400_000, pid: 1, ...o });

describe('judgePreviousRun', () => {
  it('first start without a file', () => {
    expect(judgePreviousRun(null, 5)).toEqual({ kind: 'first' });
  });
  it('clean stop', () => {
    expect(judgePreviousRun(hb({ stopped: true }), 1_030_000)).toEqual({ kind: 'clean', uptimeMs: 600_000, downMs: 30_000 });
  });
  it('unclean when heartbeat is older than 2 minutes', () => {
    const r = judgePreviousRun(hb(), 1_000_000 + UNCLEAN_GAP_MS + 1);
    expect(r).toMatchObject({ kind: 'unclean', gapMs: UNCLEAN_GAP_MS + 1, uptimeMs: 600_000 });
  });
  it('exactly 2 minutes is still a quick restart', () => {
    expect(judgePreviousRun(hb(), 1_000_000 + UNCLEAN_GAP_MS).kind).toBe('quick-restart');
  });
  it('a clean stop wins however long the gap', () => {
    expect(judgePreviousRun(hb({ stopped: true }), 99_999_999).kind).toBe('clean');
  });
});

describe('parseHeartbeat / fmtDuration', () => {
  it('rejects junk', () => {
    expect(parseHeartbeat('nope')).toBeNull();
    expect(parseHeartbeat('{"ts":1}')).toBeNull();
    expect(parseHeartbeat('{"ts":2,"startedAt":1,"pid":3,"stopped":true}')).toMatchObject({ stopped: true });
  });
  it('formats', () => {
    expect(fmtDuration(30_000)).toBe('30s');
    expect(fmtDuration(10 * 60_000)).toBe('10m');
    expect(fmtDuration(3 * 3600_000)).toBe('3.0h');
  });
});
