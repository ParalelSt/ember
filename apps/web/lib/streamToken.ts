import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serverLogger } from '@/lib/logger/server';

/** Short-lived signed stream URLs, for players that cannot send the
 *  listener's cookie: a Chromecast, a Google speaker or an Android TV
 *  fetches the song itself, with no Ember session at all.
 *
 *  A token names ONE track, ONE use (`stream` for the audio, `art` for an
 *  upload's cover), the member it was issued to and when it dies. It is
 *  accepted by exactly three routes (the YouTube stream, an upload's stream
 *  and an upload's cover) and only for the track and use it names. Anywhere
 *  else it is an ignored query parameter: it never signs anyone in. A
 *  stream it lets through counts against the issuing member's budget
 *  (lib/downloadAccess), exactly as their own play would. */

export type StreamTokenScope = 'stream' | 'art';

/** How long a cast queue stays playable: a long listening session, not a
 *  standing credential. */
export const STREAM_TOKEN_TTL_SEC = 6 * 60 * 60;

/** The query parameter that carries a token. */
export const STREAM_TOKEN_PARAM = 'st';

/** Tracks a token may name: a YouTube video or a member upload. */
const TRACK_ID_RE = /^(youtube:[A-Za-z0-9_-]{11}|upload:[A-Za-z0-9]{1,40})$/;

/** A user id as PocketBase makes them (the claim is ours, but a token is
 *  input: nothing odd gets as far as a rate limit key). */
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Domain separation: an HMAC made for anything else with the same secret
 *  can never pass as a stream token. */
const CONTEXT = 'ember-stream-token-v1';

interface Claims {
  /** Track id, `youtube:<videoId>` or `upload:<recordId>`. */
  t: string;
  /** Member the token was issued to. */
  u: string;
  s: StreamTokenScope;
  /** Expiry, unix seconds. */
  e: number;
}

export function isSignableTrackId(id: unknown): id is string {
  return typeof id === 'string' && TRACK_ID_RE.test(id);
}

// ── The secret ──────────────────────────────────────────────────────────

let cachedSecret: Buffer | null = null;

function musicDir(): string {
  return process.env.MUSIC_DIR ?? path.join(path.resolve(process.cwd(), '..', '..'), 'my_music');
}

/** Where the generated secret is kept when STREAM_TOKEN_SECRET is not set:
 *  beside the cached audio, readable by the server's user only. */
export function secretFilePath(): string {
  return path.join(musicDir(), '.stream-token-secret');
}

/** STREAM_TOKEN_SECRET when the host set one (at least 32 characters),
 *  else a random secret generated once and kept on disk so tokens survive a
 *  restart. A disk that cannot be written still works: the secret then
 *  lives in memory and tokens die with the process. */
function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const configured = (process.env.STREAM_TOKEN_SECRET ?? '').trim();
  if (configured.length >= 32) {
    cachedSecret = Buffer.from(configured, 'utf8');
    return cachedSecret;
  }
  if (configured) {
    serverLogger.error('stream-token', 'STREAM_TOKEN_SECRET is shorter than 32 characters; using the generated secret instead');
  }
  const file = secretFilePath();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) {
      cachedSecret = Buffer.from(existing, 'utf8');
      return cachedSecret;
    }
  } catch {
    /* not made yet */
  }
  const readBack = () => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return '';
    }
  };
  const fresh = randomBytes(32).toString('hex');
  // Written whole to a temp file first, then put in place in one step, so
  // nobody ever reads a half-written secret: link() fails when the file is
  // there already (another process won the race: use theirs), and rename()
  // replaces one that is there but unusable (empty or cut short), which
  // would otherwise end every link on every restart.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, fresh, { mode: 0o600, flag: 'wx' });
    try {
      fs.linkSync(tmp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (readBack().length < 32) fs.renameSync(tmp, file);
    }
    const kept = readBack();
    cachedSecret = Buffer.from(kept.length >= 32 ? kept : fresh, 'utf8');
  } catch (e) {
    serverLogger.error('stream-token', 'could not keep the stream token secret on disk; cast links end on restart', { file }, e);
    cachedSecret = Buffer.from(fresh, 'utf8');
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* moved into place, or never made */
    }
  }
  return cachedSecret;
}

/** Tests only: forget the secret so the next call reads env and disk again. */
export function _resetStreamTokenSecret(): void {
  cachedSecret = null;
}

// ── Sign and verify ─────────────────────────────────────────────────────

function mac(payload: string): Buffer {
  return createHmac('sha256', secret()).update(`${CONTEXT}.${payload}`).digest();
}

/** A token for [trackId] and [scope], issued to [userId], valid [ttlSec]. */
export function signStreamToken(opts: {
  trackId: string;
  userId: string;
  scope: StreamTokenScope;
  nowMs?: number;
  ttlSec?: number;
}): { token: string; expiresAt: number } {
  if (!isSignableTrackId(opts.trackId)) throw new Error('not a track id');
  if (!USER_ID_RE.test(opts.userId)) throw new Error('not a user id');
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const e = now + Math.min(opts.ttlSec ?? STREAM_TOKEN_TTL_SEC, STREAM_TOKEN_TTL_SEC);
  const claims: Claims = { t: opts.trackId, u: opts.userId, s: opts.scope, e };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { token: `${payload}.${mac(payload).toString('base64url')}`, expiresAt: e };
}

/** The member a token was issued to, when it is genuine, unexpired, and
 *  names exactly this track and use. null otherwise, for any reason. */
export function verifyStreamToken(
  token: string | null | undefined,
  expect: { trackId: string; scope: StreamTokenScope; nowMs?: number },
): { userId: string } | null {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  const wanted = mac(payload);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  let claims: Partial<Claims>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Claims>;
  } catch {
    return null;
  }
  const now = Math.floor((expect.nowMs ?? Date.now()) / 1000);
  if (typeof claims.e !== 'number' || !Number.isFinite(claims.e) || claims.e <= now) return null;
  // Never longer-lived than we issue, whatever the claim says.
  if (claims.e - now > STREAM_TOKEN_TTL_SEC + 60) return null;
  if (claims.t !== expect.trackId || claims.s !== expect.scope) return null;
  if (typeof claims.u !== 'string' || !USER_ID_RE.test(claims.u)) return null;
  return { userId: claims.u };
}

/** verifyStreamToken on the request's `st` parameter. */
export function streamTokenUser(
  request: Request,
  trackId: string,
  scope: StreamTokenScope,
): string | null {
  let token: string | null;
  try {
    token = new URL(request.url).searchParams.get(STREAM_TOKEN_PARAM);
  } catch {
    return null;
  }
  return verifyStreamToken(token, { trackId, scope })?.userId ?? null;
}
