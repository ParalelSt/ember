import { LINK_TOKEN_RE, normalizeCode } from '@/lib/qrLogin/codes';

/** What a scanned QR asks this phone to approve: the approve token of a
 *  sign-in QR (/link/<token>), or a short code someone made into a QR. */
export type ScannedCredential = { kind: 'token'; token: string } | { kind: 'code'; code: string };

export const NOT_A_SIGN_IN_CODE = "That's not an Ember sign-in code";

const LINK_PATH = /^\/link\/([^/]+)\/?$/;

/** Reads a scanned value. Accepts only:
 *   - an approve link on this server (same origin as `origin`, the app's own
 *     server URL), path /link/<token>
 *   - a bare short code, as typed in Settings > Devices (ABCD-EFGH)
 *  Anything else (another site, another Ember server, a playlist link,
 *  random text) is null, and the caller does not navigate. */
export function parseScanned(raw: unknown, origin: string): ScannedCredential | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 2048) return null;

  const code = normalizeCode(value);
  if (code) return { kind: 'code', code };

  let url: URL;
  let own: URL;
  try {
    url = new URL(value);
    own = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== own.origin) return null;
  // A user:password@ part never comes from Ember's own QR.
  if (url.username || url.password) return null;
  const token = LINK_PATH.exec(url.pathname)?.[1];
  return token && LINK_TOKEN_RE.test(token) ? { kind: 'token', token } : null;
}
