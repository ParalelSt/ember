import 'server-only';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { likesFromPage, type YoutubeVideo } from '@/lib/import/google/likes';
import type { GoogleFailure, LikedSong } from '@/lib/import/sources/ytmusicLiked';

/** Google's OAuth 2.0 device flow ("TVs and Limited Input devices") and the
 *  one YouTube Data API call Ember makes with it, in plain fetch.
 *
 *  Nothing here logs, and no error it throws carries a token, a device code
 *  or a response body: a failure is a `GoogleFailure`, which the routes turn
 *  into one of the sentences in lib/import/sources/ytmusicLiked.ts. */

export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const DEFAULT_VERIFICATION_URL = 'https://www.google.com/device';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 15_000;
/** A page is 50 likes, so this is 20 000 likes looked at, or 400 of the
 *  10 000 units of Data API quota Google gives a project a day. */
export const MAX_LIKE_PAGES = 400;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** device/code, token and revoke live here. */
  oauthBase: string;
  /** The YouTube Data API v3. */
  apiBase: string;
}

/** The host's Google client, or null when either half is missing. The bases
 *  are overridable so the tests can stand a fake Google in. */
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const base = (v: string | undefined, fallback: string) => (v?.trim() || fallback).replace(/\/+$/, '');
  return {
    clientId,
    clientSecret,
    oauthBase: base(env.GOOGLE_OAUTH_BASE, 'https://oauth2.googleapis.com'),
    apiBase: base(env.YOUTUBE_API_BASE, 'https://www.googleapis.com/youtube/v3'),
  };
}

/** A Google failure as the one word the routes know. */
export class GoogleError extends Error {
  constructor(readonly reason: GoogleFailure) {
    super(`google: ${reason}`);
    this.name = 'GoogleError';
  }
}

async function post(url: string, form: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

/** Step one: a code for the person to type on google.com/device. */
export async function requestDeviceCode(cfg: GoogleConfig): Promise<DeviceCode> {
  let res: Response;
  try {
    res = await post(`${cfg.oauthBase}/device/code`, { client_id: cfg.clientId, scope: YOUTUBE_READONLY_SCOPE });
  } catch {
    throw new GoogleError('unreachable');
  }
  const body = await json(res);
  if (!res.ok) {
    const error = String(body.error ?? '');
    if (error === 'rate_limit_exceeded' || res.status === 429) throw new GoogleError('busy');
    if (res.status >= 500) throw new GoogleError('unreachable');
    // invalid_client (not a "TVs and Limited Input devices" client, or a
    // wrong id), invalid_scope, and anything else is the host's setup.
    throw new GoogleError('setupWrong');
  }
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
  const userCode = typeof body.user_code === 'string' ? body.user_code : '';
  if (!deviceCode || !userCode) throw new GoogleError('setupWrong');
  const url = typeof body.verification_url === 'string' ? body.verification_url : '';
  return {
    deviceCode,
    userCode,
    verificationUrl: /^https?:\/\//.test(url) ? url : DEFAULT_VERIFICATION_URL,
    expiresIn: Number(body.expires_in) > 0 ? Number(body.expires_in) : 1800,
    interval: Number(body.interval) > 0 ? Number(body.interval) : 5,
  };
}

export type TokenPoll =
  | { kind: 'token'; accessToken: string; refreshToken: string | null; scope: string }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  /** Google or the network hiccuped: ask again at the next interval. */
  | { kind: 'transient' }
  | { kind: 'fail'; reason: GoogleFailure };

/** Step two, repeated at Google's interval until the person answers. */
export async function pollToken(cfg: GoogleConfig, deviceCode: string, signal?: AbortSignal): Promise<TokenPoll> {
  let res: Response;
  try {
    res = await post(
      `${cfg.oauthBase}/token`,
      { client_id: cfg.clientId, client_secret: cfg.clientSecret, device_code: deviceCode, grant_type: DEVICE_GRANT },
      signal,
    );
  } catch {
    return { kind: 'transient' };
  }
  const body = await json(res);
  if (res.ok) {
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    if (!accessToken) return { kind: 'fail', reason: 'readFailed' };
    return {
      kind: 'token',
      accessToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }
  switch (String(body.error ?? '')) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'access_denied':
      return { kind: 'fail', reason: 'denied' };
    case 'expired_token':
    case 'invalid_grant':
      return { kind: 'fail', reason: 'expired' };
    case 'org_internal':
    case 'admin_policy_enforced':
      return { kind: 'fail', reason: 'blocked' };
    case 'invalid_client':
    case 'unauthorized_client':
    case 'unsupported_grant_type':
      return { kind: 'fail', reason: 'setupWrong' };
    default:
      return res.status >= 500 || res.status === 429 ? { kind: 'transient' } : { kind: 'fail', reason: 'readFailed' };
  }
}

/** Sign Ember out of the account again. Revoking either token ends the whole
 *  grant; the access token is the fallback when the refresh one will not go.
 *  Best effort: the token dies on its own within the hour anyway. Nothing is
 *  logged either way. */
export async function revokeTokens(cfg: GoogleConfig, tokens: { accessToken: string; refreshToken: string | null }): Promise<boolean> {
  for (const token of [tokens.refreshToken, tokens.accessToken]) {
    if (!token) continue;
    try {
      const res = await post(`${cfg.oauthBase}/revoke`, { token });
      if (res.ok) return true;
    } catch {
      // The next token, if there is one.
    }
  }
  return false;
}

export interface LikedVideos {
  /** Every liked video, not only songs: YouTube Music says which are songs
   *  during the transfer. */
  songs: LikedSong[];
  /** There was more than one transfer may carry, or more than Ember reads. */
  truncated: boolean;
}

/** Step three: every like, newest first as Google lists them, paged to the
 *  end, cut at the transfer cap. */
export async function readLikes(
  cfg: GoogleConfig,
  accessToken: string,
  { cap = MAX_TRANSFER_ITEMS, maxPages = MAX_LIKE_PAGES, signal }: { cap?: number; maxPages?: number; signal?: AbortSignal } = {},
): Promise<LikedVideos> {
  const seen = new Set<string>();
  const songs: LikedSong[] = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ myRating: 'like', part: 'snippet,contentDetails', maxResults: '50' });
    if (pageToken) q.set('pageToken', pageToken);
    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}/videos?${q}`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleError(signal?.aborted ? 'gone' : 'unreachable');
    }
    const body = await json(res);
    if (!res.ok) throw new GoogleError(apiFailure(res.status, body));
    songs.push(...likesFromPage(Array.isArray(body.items) ? (body.items as YoutubeVideo[]) : [], seen));
    if (songs.length > cap) return { songs: songs.slice(0, cap), truncated: true };
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) return { songs, truncated: false };
  }
  // Ran out of pages Ember is willing to read with likes still to go.
  return { songs, truncated: true };
}

function apiFailure(status: number, body: Record<string, unknown>): GoogleFailure {
  const err = body.error as { errors?: { reason?: string }[] } | undefined;
  const reason = err?.errors?.[0]?.reason ?? '';
  if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) return 'quota';
  if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return 'noScope';
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return 'setupWrong';
  if (status >= 500 || status === 429) return 'unreachable';
  return 'readFailed';
}
