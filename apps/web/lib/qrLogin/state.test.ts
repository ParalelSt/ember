import { describe, expect, it } from 'vitest';
import { DELIVER_GRACE_MS, effectiveStatus, parsePbDate, qrTtlMs, transition, type QrRow } from './state';

const T0 = Date.parse('2026-10-07T12:00:00.000Z');
const EXPIRES = '2026-10-07 12:03:00.000Z'; // PocketBase's own date format
const EXP_MS = Date.parse('2026-10-07T12:03:00.000Z');
const row = (status: string, expires = EXPIRES): QrRow => ({ status, expires });

describe('parsePbDate', () => {
  it('reads PocketBase dates and ISO dates, NaN for anything else', () => {
    expect(parsePbDate('2026-10-07 12:03:00.000Z')).toBe(EXP_MS);
    expect(parsePbDate('2026-10-07T12:03:00.000Z')).toBe(EXP_MS);
    expect(parsePbDate('')).toBeNaN();
    expect(parsePbDate(undefined)).toBeNaN();
    expect(parsePbDate('soon')).toBeNaN();
  });
});

describe('effectiveStatus', () => {
  it('pending is pending until the expiry, expired from the expiry on (boundary included)', () => {
    expect(effectiveStatus(row('pending'), T0)).toBe('pending');
    expect(effectiveStatus(row('pending'), EXP_MS - 1)).toBe('pending');
    expect(effectiveStatus(row('pending'), EXP_MS)).toBe('expired');
    expect(effectiveStatus(row('pending'), EXP_MS + 1)).toBe('expired');
  });

  it('an approved row waits for its device a little past the expiry, then expires', () => {
    expect(effectiveStatus(row('approved'), EXP_MS + DELIVER_GRACE_MS - 1)).toBe('approved');
    expect(effectiveStatus(row('approved'), EXP_MS + DELIVER_GRACE_MS)).toBe('expired');
  });

  it('final states stay what they are', () => {
    for (const s of ['used', 'denied', 'expired']) expect(effectiveStatus(row(s), EXP_MS + 10 * 60_000)).toBe(s);
  });

  it('an unknown status or an unreadable expiry is expired, never pending', () => {
    expect(effectiveStatus(row('weird'), T0)).toBe('expired');
    expect(effectiveStatus(row('pending', ''), T0)).toBe('expired');
    expect(effectiveStatus(row('approved', 'nope'), T0)).toBe('expired');
  });
});

describe('transition', () => {
  it('approve and deny: only a pending, unexpired row', () => {
    expect(transition(row('pending'), 'approve', T0)).toEqual({ ok: true, status: 'approved' });
    expect(transition(row('pending'), 'deny', T0)).toEqual({ ok: true, status: 'denied' });
    for (const ev of ['approve', 'deny'] as const) {
      expect(transition(row('pending'), ev, EXP_MS)).toEqual({ ok: false, error: 'expired' });
      expect(transition(row('expired'), ev, T0)).toEqual({ ok: false, error: 'expired' });
      expect(transition(row('approved'), ev, T0)).toEqual({ ok: false, error: 'used' });
      expect(transition(row('used'), ev, T0)).toEqual({ ok: false, error: 'used' });
      expect(transition(row('denied'), ev, T0)).toEqual({ ok: false, error: 'denied' });
    }
  });

  it('deliver: approved -> used, once', () => {
    expect(transition(row('approved'), 'deliver', T0)).toEqual({ ok: true, status: 'used' });
    expect(transition(row('approved'), 'deliver', EXP_MS + DELIVER_GRACE_MS - 1)).toEqual({ ok: true, status: 'used' });
    expect(transition(row('approved'), 'deliver', EXP_MS + DELIVER_GRACE_MS)).toEqual({ ok: false, error: 'expired' });
    expect(transition(row('used'), 'deliver', T0)).toEqual({ ok: false, error: 'used' });
    expect(transition(row('denied'), 'deliver', T0)).toEqual({ ok: false, error: 'denied' });
    expect(transition(row('expired'), 'deliver', T0)).toEqual({ ok: false, error: 'expired' });
    expect(transition(row('pending'), 'deliver', T0)).toEqual({ ok: false, error: 'not_pending' });
  });
});

describe('qrTtlMs', () => {
  it('is 3 minutes by default', () => {
    expect(qrTtlMs(undefined)).toBe(180_000);
    expect(qrTtlMs('')).toBe(180_000);
    expect(qrTtlMs('abc')).toBe(180_000);
  });

  it('a test may shorten it, nobody may lengthen it', () => {
    expect(qrTtlMs('3')).toBe(3_000);
    expect(qrTtlMs('600')).toBe(180_000);
    expect(qrTtlMs('0')).toBe(180_000);
    expect(qrTtlMs('-5')).toBe(180_000);
  });
});
