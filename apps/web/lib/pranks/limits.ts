import type { PrankKind, PrankParams, PrankStatus } from './types';

/** Every guard-rail number, as the owner decided them (2026-09-23). */
export const PRANK_LIMITS = {
  /** A row nobody acknowledged within this long reads as expired. */
  expirySec: 45,
  /** Music level under a ducking sound. */
  duck: 0.3,
  soundMaxSec: 30,
  swapMinSec: 5,
  swapMaxSec: 300,
  volumeMin: 0.1,
  volumeMax: 1,
  /** Per target, pings excluded (a ping is not something they hear). */
  perTargetPerHour: 20,
  /** Minimum gap between two sounds on the same person. */
  soundGapSec: 15,
  /** Per admin, every kind. */
  perAdminPerHour: 60,
  scheduleMinIntervalSec: 60,
  scheduleMaxSpanSec: 2 * 60 * 60,
  maxActiveSchedulesPerTarget: 3,
} as const;

export const PRANK_KINDS: readonly PrankKind[] = ['swap', 'sound', 'ping'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Normalises what an admin sent into safe params: out-of-range numbers are
 *  clamped, unknown enum values fall back to the defaults. Never trusts a
 *  client-sent streamUrl (the server sets that). */
export function normaliseParams(kind: PrankKind, raw: unknown): PrankParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const L = PRANK_LIMITS;
  return {
    durationSec:
      kind === 'swap'
        ? Math.round(clamp(num(r.durationSec, 20), L.swapMinSec, L.swapMaxSec))
        : kind === 'sound'
          ? L.soundMaxSec
          : 0,
    volume: Math.round(clamp(num(r.volume, 1), L.volumeMin, L.volumeMax) * 100) / 100,
    mode: r.mode === 'duck' ? 'duck' : 'over',
    startFrom: r.startFrom === 'same' ? 'same' : 'start',
  };
}

/** The part of a pranks row the caps look at. `created` in ms. */
export interface RecentPrank {
  kind: PrankKind;
  status: PrankStatus;
  created: number;
}

export type CapResult = { ok: true } | { ok: false; reason: CapReason; retryAfterSec: number };
export type CapReason = 'target-hourly' | 'admin-hourly' | 'sound-gap' | 'swap-active';

const HOUR_MS = 60 * 60 * 1000;
/** Rows that never reached anybody do not count against a cap. */
const counts = (p: RecentPrank) => p.status !== 'cancelled' && p.status !== 'expired';

/** Frequency caps for one new prank. `forTarget` is the target's rows from
 *  the last hour (any issuer), `byAdmin` the issuing admin's rows from the
 *  last hour (any target). */
export function checkCaps(
  kind: PrankKind,
  forTarget: RecentPrank[],
  byAdmin: RecentPrank[],
  now: number,
): CapResult {
  const L = PRANK_LIMITS;
  const secsUntil = (t: number) => Math.max(1, Math.ceil((t - now) / 1000));

  const adminRows = byAdmin.filter((p) => counts(p) && p.created > now - HOUR_MS);
  if (adminRows.length >= L.perAdminPerHour) {
    const oldest = Math.min(...adminRows.map((p) => p.created));
    return { ok: false, reason: 'admin-hourly', retryAfterSec: secsUntil(oldest + HOUR_MS) };
  }
  if (kind === 'ping') return { ok: true };

  const targetRows = forTarget.filter((p) => counts(p) && p.kind !== 'ping' && p.created > now - HOUR_MS);
  if (targetRows.length >= L.perTargetPerHour) {
    const oldest = Math.min(...targetRows.map((p) => p.created));
    return { ok: false, reason: 'target-hourly', retryAfterSec: secsUntil(oldest + HOUR_MS) };
  }
  if (kind === 'sound') {
    const last = Math.max(0, ...targetRows.filter((p) => p.kind === 'sound').map((p) => p.created));
    if (last > now - L.soundGapSec * 1000) {
      return { ok: false, reason: 'sound-gap', retryAfterSec: secsUntil(last + L.soundGapSec * 1000) };
    }
  }
  if (kind === 'swap') {
    // Pending or delivered and young enough to still be running.
    const windowMs = (L.swapMaxSec + L.expirySec) * 1000;
    const running = targetRows.filter(
      (p) => p.kind === 'swap' && (p.status === 'pending' || p.status === 'delivered') && p.created > now - windowMs,
    );
    if (running.length > 0) {
      const newest = Math.max(...running.map((p) => p.created));
      return { ok: false, reason: 'swap-active', retryAfterSec: secsUntil(newest + windowMs) };
    }
  }
  return { ok: true };
}

/** A pending row whose window has passed reads as expired. */
export function isExpired(status: PrankStatus, expiresAtMs: number, now: number): boolean {
  return status === 'pending' && expiresAtMs < now;
}

export type AckResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; status: 409 | 410; error: string };

/** The only forward moves a target may make: pending to delivered or
 *  skipped (inside the window), delivered to done. */
export function applyAck(
  row: { status: PrankStatus; expiresAtMs: number },
  ack: { status: string; reason?: string; engine?: string; appVersion?: string; playedSec?: number },
  now: number,
): AckResult {
  const at = pbDate(now);
  const extras: Record<string, unknown> = {};
  if (typeof ack.engine === 'string') extras.engine = ack.engine.slice(0, 20);
  if (typeof ack.appVersion === 'string') extras.app_version = ack.appVersion.slice(0, 80);

  if (row.status === 'pending' && (ack.status === 'delivered' || ack.status === 'skipped')) {
    if (row.expiresAtMs < now) return { ok: false, status: 410, error: 'expired' };
    const reason = ack.status === 'skipped' ? String(ack.reason ?? 'error:unknown').slice(0, 120) : '';
    return { ok: true, patch: { status: ack.status, reason, delivered_at: at, ...extras } };
  }
  if (row.status === 'delivered' && ack.status === 'done') {
    const played = typeof ack.playedSec === 'number' && Number.isFinite(ack.playedSec)
      ? Math.max(0, Math.round(ack.playedSec * 10) / 10)
      : 0;
    return { ok: true, patch: { status: 'done', done_at: at, played_sec: played } };
  }
  return { ok: false, status: 409, error: `cannot go from ${row.status} to ${ack.status}` };
}

/** PocketBase's date format ("2026-09-23 12:00:00.000Z"), sortable as text. */
export function pbDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** Parses a PocketBase date (space or T separated) to ms; NaN when empty. */
export function parsePbDate(s: unknown): number {
  if (typeof s !== 'string' || !s) return NaN;
  return Date.parse(s.replace(' ', 'T'));
}
