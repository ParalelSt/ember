import 'server-only';
import type PocketBase from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { normalizeCode } from './codes';
import { csrfRefusal } from './sameOrigin';
import { hash, isSecret, sameHash } from './secrets';
import { transition, type QrEvent } from './state';

/** Shared by the QR sign-in routes under app/api/auth/qr (plan 2b). Nothing
 *  here logs a token, a secret, a code or a minted session: log lines carry
 *  the request id, the user id, the device label and the network flag. */

export const QR_COOKIE = 'ember_qr';
export const QR_COOKIE_PATH = '/api/auth/qr';
export const NO_SUCH_REQUEST = 'No sign-in request with that code.';
/** PocketBase record ids: 15 lowercase letters and digits. */
export const ID_RE = /^[a-z0-9]{15}$/;

const TEN_MIN = 10 * 60_000;
export const QR_LIMITS = {
  start: { windowMs: TEN_MIN, max: 10 },
  statusPerRequest: { windowMs: 1000, max: 2 },
  statusPerIp: { windowMs: TEN_MIN, max: 300 },
  lookupCode: { windowMs: TEN_MIN, max: 5 },
  lookupCodeAll: { windowMs: TEN_MIN, max: 60 },
  lookupToken: { windowMs: TEN_MIN, max: 20 },
  decide: { windowMs: TEN_MIN, max: 10 },
};

export interface LoginRequestRow {
  id: string;
  created: string;
  token_hash: string;
  poll_hash: string;
  code: string;
  status: string;
  user: string;
  device: string;
  shell: string;
  requester_ip: string;
  approver_ip: string;
  expires: string;
  approved_at: string;
  used_at: string;
  minted_hash: string;
}

/** JSON that no cache keeps. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** A failure the route did not expect (PocketBase down, admin credentials
 *  missing). Logged by status only: a PocketBase error carries the request
 *  URL, whose filter could hold a code, so the error itself is never logged
 *  (lib/upsertTrack's fromError would). */
export function failure(e: unknown): Response {
  const status = (e as { status?: unknown } | null)?.status;
  serverLogger.error('auth', 'qr route failed', { status: typeof status === 'number' ? status : undefined });
  return json({ error: "Can't reach Ember right now, try again." }, 503);
}

/** One answer for "no such request", "expired" and "not yours". */
export function noSuchRequest(): Response {
  return json({ error: NO_SUCH_REQUEST }, 404);
}

export function isHttps(req: Request): boolean {
  const proto = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  if (proto) return proto === 'https';
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The poll cookie: only the requesting browser holds it, scripts cannot
 *  read it, and it goes nowhere but the QR routes. */
export function qrCookie(value: string, maxAgeS: number, https: boolean): string {
  return `${QR_COOKIE}=${encodeURIComponent(value)}; Path=${QR_COOKIE_PATH}; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
}

export function clearQrCookie(https: boolean): string {
  return `${QR_COOKIE}=; Path=${QR_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
}

/** The poll cookie as { id, secret }, or null when missing or malformed. */
export function readQrCookie(req: Request): { id: string; secret: string } | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== QR_COOKIE) continue;
    let value: string;
    try {
      value = decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
    const [id, secret, extra] = value.split('.');
    if (extra !== undefined || !ID_RE.test(id ?? '') || !isSecret(secret)) return null;
    return { id, secret };
  }
  return null;
}

export function pbIso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function getRow(pb: PocketBase, id: string): Promise<LoginRequestRow | null> {
  try {
    return (await pb.collection('login_requests').getOne(id, { requestKey: null })) as unknown as LoginRequestRow;
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
}

export async function findRow(pb: PocketBase, field: 'token_hash' | 'code', value: string): Promise<LoginRequestRow | null> {
  try {
    return (await pb
      .collection('login_requests')
      .getFirstListItem(pb.filter(`${field} = {:v}`, { v: value }), { requestKey: null })) as unknown as LoginRequestRow;
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
}

/** One change at a time per request id in this process, so two polls (or
 *  an approve and a deny) arriving together cannot both act. */
const locks = new Map<string, Promise<void>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/** Does the credential in the body (the token from the link, or the typed
 *  code) belong to this row? Compared as hashes, in constant time. */
export function credentialMatches(row: LoginRequestRow, body: { token?: unknown; code?: unknown }): boolean {
  if (body.token !== undefined) return isSecret(body.token) && sameHash(hash(body.token), row.token_hash);
  if (body.code !== undefined) {
    const code = normalizeCode(body.code);
    return !!code && !!row.code && sameHash(hash(code), hash(row.code));
  }
  return false;
}

/** approve and deny: a signed-in member, a same-origin JSON POST, the id
 *  AND the credential, a pending unexpired row. */
export async function decide(req: Request, event: Exclude<QrEvent, 'deliver'>): Promise<Response> {
  try {
    const refused = csrfRefusal(req);
    if (refused) return refused;
    let user: { id: string };
    try {
      ({ user } = await requireUser());
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      throw e;
    }
    const limited = rateLimitResponse(`qr-${event}:${user.id}`, QR_LIMITS.decide);
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as { id?: unknown; token?: unknown; code?: unknown } | null;
    if (!body || typeof body !== 'object') return json({ error: 'Send the request id and its code' }, 400);
    const id = typeof body.id === 'string' ? body.id : '';
    if (!ID_RE.test(id) || (body.token === undefined && body.code === undefined)) return noSuchRequest();

    const pb = await createAdminClient();
    const ip = clientIp(req);
    return await withLock(id, async () => {
      const row = await getRow(pb, id);
      if (!row || !credentialMatches(row, body)) return noSuchRequest();
      const now = Date.now();
      const next = transition(row, event, now);
      if (!next.ok) return json({ status: next.error }, 409);
      if (next.status === 'approved') {
        await pb.collection('login_requests').update(id, { status: 'approved', user: user.id, approver_ip: ip.slice(0, 64), approved_at: pbIso(now) }, { requestKey: null });
      } else {
        await pb.collection('login_requests').update(id, { status: 'denied', approver_ip: ip.slice(0, 64) }, { requestKey: null });
      }
      serverLogger.info('auth', `qr ${next.status}`, {
        requestId: row.id,
        userId: user.id,
        device: row.device,
        sameNetwork: row.requester_ip === ip,
      });
      return json({ ok: true });
    });
  } catch (e) {
    return failure(e);
  }
}
