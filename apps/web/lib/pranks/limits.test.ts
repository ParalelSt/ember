import { describe, expect, it } from 'vitest';
import { applyAck, checkCaps, isExpired, normaliseParams, parsePbDate, pbDate, PRANK_LIMITS, type RecentPrank } from './limits';

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0);
const ago = (sec: number) => NOW - sec * 1000;
const row = (kind: RecentPrank['kind'], secAgo: number, status: RecentPrank['status'] = 'done'): RecentPrank => ({
  kind, status, created: ago(secAgo),
});

describe('PRANK_LIMITS (owner decisions)', () => {
  it('holds the decided numbers', () => {
    expect(PRANK_LIMITS).toMatchObject({
      expirySec: 45, duck: 0.3, soundMaxSec: 30, swapMinSec: 5, swapMaxSec: 300,
      perTargetPerHour: 20, soundGapSec: 15, scheduleMinIntervalSec: 60, scheduleMaxSpanSec: 7200,
    });
  });
});

describe('normaliseParams', () => {
  it('clamps volume into 0.1..1', () => {
    expect(normaliseParams('sound', { volume: 3 })).toMatchObject({ volume: 1 });
    expect(normaliseParams('sound', { volume: 0 })).toMatchObject({ volume: 0.1 });
  });
  it('fills defaults: from the start, over the music', () => {
    expect(normaliseParams('ping', undefined)).toEqual({ durationSec: 0, volume: 1, mode: 'over', startFrom: 'start' });
  });
  it('keeps the known enum values and drops unknown ones', () => {
    expect(normaliseParams('sound', { mode: 'duck', startFrom: 'same' })).toMatchObject({ mode: 'duck', startFrom: 'same' });
    expect(normaliseParams('sound', { mode: 'loud', startFrom: 'end' })).toMatchObject({ mode: 'over', startFrom: 'start' });
  });
  it('caps a sound at 30 s and never carries a client streamUrl', () => {
    const p = normaliseParams('sound', { durationSec: 99, streamUrl: 'https://evil.example/x.mp3' });
    expect(p.durationSec).toBe(30);
    expect(p).not.toHaveProperty('streamUrl');
  });
});

describe('checkCaps', () => {
  it('lets a first prank through', () => {
    expect(checkCaps('sound', [], [], NOW)).toEqual({ ok: true });
  });

  it('stops the 21st prank on one person inside an hour', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('sound', 60 + i * 60));
    const r = checkCaps('sound', rows, [], NOW);
    expect(r).toMatchObject({ ok: false, reason: 'target-hourly' });
  });

  it('forgets pranks older than an hour, and ones that never arrived', () => {
    const old = Array.from({ length: 20 }, () => row('sound', 3700));
    const lost = Array.from({ length: 20 }, () => row('sound', 100, 'expired'));
    expect(checkCaps('sound', [...old, ...lost], [], NOW)).toEqual({ ok: true });
  });

  it('does not count pings against the person', () => {
    const pings = Array.from({ length: 30 }, () => row('ping', 100, 'delivered'));
    expect(checkCaps('sound', pings, [], NOW)).toEqual({ ok: true });
  });

  it('keeps 15 s between two sounds, with the wait in the answer', () => {
    const r = checkCaps('sound', [row('sound', 10)], [], NOW);
    expect(r).toEqual({ ok: false, reason: 'sound-gap', retryAfterSec: 5 });
    expect(checkCaps('sound', [row('sound', 16)], [], NOW)).toEqual({ ok: true });
  });

  it('caps an admin at 60 an hour, pings included', () => {
    const mine = Array.from({ length: 60 }, (_, i) => row('ping', 10 + i));
    expect(checkCaps('ping', [], mine, NOW)).toMatchObject({ ok: false, reason: 'admin-hourly' });
    expect(checkCaps('ping', [], mine.slice(1), NOW)).toEqual({ ok: true });
  });
});

describe('applyAck', () => {
  const pending = { status: 'pending' as const, expiresAtMs: NOW + 10_000 };

  it('moves a pending row to delivered with the engine and version', () => {
    const r = applyAck(pending, { status: 'delivered', engine: 'web', appVersion: '0.5.0' }, NOW);
    expect(r).toEqual({ ok: true, patch: { status: 'delivered', reason: '', delivered_at: pbDate(NOW), engine: 'web', app_version: '0.5.0' } });
  });

  it('keeps the reason on a skip', () => {
    const r = applyAck(pending, { status: 'skipped', reason: 'not-playing' }, NOW);
    expect(r.ok && r.patch.reason).toBe('not-playing');
  });

  it('refuses a late acknowledgement with 410', () => {
    expect(applyAck({ status: 'pending', expiresAtMs: NOW - 1 }, { status: 'delivered' }, NOW))
      .toMatchObject({ ok: false, status: 410 });
  });

  it('moves delivered to done with the played seconds', () => {
    const r = applyAck({ status: 'delivered', expiresAtMs: NOW - 99_000 }, { status: 'done', playedSec: 12.34 }, NOW);
    expect(r).toEqual({ ok: true, patch: { status: 'done', done_at: pbDate(NOW), played_sec: 12.3 } });
  });

  it('refuses every other move with 409', () => {
    expect(applyAck(pending, { status: 'done' }, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(applyAck({ status: 'done', expiresAtMs: NOW }, { status: 'delivered' }, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(applyAck({ status: 'cancelled', expiresAtMs: NOW + 1000 }, { status: 'delivered' }, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(applyAck(pending, { status: 'expired' }, NOW)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('dates and expiry', () => {
  it('round-trips the PocketBase date format', () => {
    expect(pbDate(NOW)).toBe('2026-09-23 20:00:00.000Z');
    expect(parsePbDate(pbDate(NOW))).toBe(NOW);
    expect(parsePbDate('')).toBeNaN();
  });
  it('only a pending row past its window is expired', () => {
    expect(isExpired('pending', NOW - 1, NOW)).toBe(true);
    expect(isExpired('pending', NOW + 1, NOW)).toBe(false);
    expect(isExpired('delivered', NOW - 1, NOW)).toBe(false);
  });
});
