/** The QR sign-in state machine (plan 2a, 2b), in one place so every route
 *  applies the same rules and the rules are tested once.
 *
 *    pending --approve--> approved --deliver--> used
 *    pending --deny-----> denied
 *    pending, past expires -> expired
 *
 *  Expiry is decided here, on the Next server's clock, against the expires
 *  date the start route wrote; the PocketBase sweep is only housekeeping. */

export type QrStatus = 'pending' | 'approved' | 'used' | 'denied' | 'expired';
export type QrEvent = 'approve' | 'deny' | 'deliver';
export type QrError = 'expired' | 'used' | 'denied' | 'not_pending';

export interface QrRow {
  status: string;
  expires: string;
}

/** The default and the ceiling: 3 minutes. Renew, never lengthen. */
export const MAX_TTL_MS = 180_000;

/** After approval the requesting device gets its session on its next poll
 *  (2 s). Approving in the last seconds of a request must not be wasted, so
 *  an approved row is deliverable a little past the expiry, then not. */
export const DELIVER_GRACE_MS = 30_000;

/** QR_LOGIN_TTL_S (tests set it low): shortens the TTL, never lengthens it. */
export function qrTtlMs(raw: string | undefined): number {
  const s = Number(raw);
  if (!raw || !Number.isFinite(s) || s <= 0) return MAX_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.round(s * 1000));
}

/** A PocketBase date ("2026-10-07 12:03:00.000Z") or an ISO one, as ms. */
export function parsePbDate(value: unknown): number {
  if (typeof value !== 'string' || !value) return NaN;
  return Date.parse(value.replace(' ', 'T'));
}

/** The status as of `now`: a pending row past its expiry is expired, an
 *  approved one past the delivery grace too. Anything unreadable counts as
 *  expired, never as pending. */
export function effectiveStatus(row: QrRow, now: number): QrStatus {
  const expires = parsePbDate(row.expires);
  switch (row.status) {
    case 'pending':
      return Number.isFinite(expires) && now < expires ? 'pending' : 'expired';
    case 'approved':
      return Number.isFinite(expires) && now < expires + DELIVER_GRACE_MS ? 'approved' : 'expired';
    case 'used':
    case 'denied':
    case 'expired':
      return row.status;
    default:
      return 'expired';
  }
}

export type QrTransition = { ok: true; status: QrStatus } | { ok: false; error: QrError };

function refusal(status: QrStatus): QrError {
  if (status === 'expired') return 'expired';
  if (status === 'denied') return 'denied';
  if (status === 'used' || status === 'approved') return 'used';
  return 'not_pending';
}

export function transition(row: QrRow, event: QrEvent, now: number): QrTransition {
  const status = effectiveStatus(row, now);
  if (event === 'deliver') {
    if (status === 'approved') return { ok: true, status: 'used' };
    return { ok: false, error: refusal(status) };
  }
  if (status !== 'pending') return { ok: false, error: refusal(status) };
  return { ok: true, status: event === 'approve' ? 'approved' : 'denied' };
}
