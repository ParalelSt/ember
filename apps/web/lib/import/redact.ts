/** Take the credentials out of any text before it is written down.
 *
 *  A transfer from YouTube Music signs the person in with Google for the
 *  minute it takes to read their likes (lib/import/google/): the server holds
 *  an access token, a refresh token and a device code in memory, and the
 *  host's client secret sits in its env. None of it is ever meant to be
 *  written anywhere, but a stray log line, a Discord bug report or an error
 *  message quoting a request would outlive the call. So everything that
 *  could carry one goes through here first: the python helper's stderr,
 *  every server log entry (lib/logger/sanitize.ts), and the sentence a failed
 *  request answers with. Google session cookies are covered too, since a
 *  helper error can quote a request of its own.
 *
 *  Pure and cheap: plain regex, no dependencies, safe on both sides of the
 *  wire. Over-matching is fine, a missed secret is not. */

export const REDACTED = '[redacted]';

/** Cookie names that identify a Google account, plus the generic prefixes
 *  YouTube uses for the same thing. */
const SESSION_COOKIE_RE =
  /\b((?:__Secure-|__Host-)?[0-9]*P?(?:SAPISID|APISID|SIDTS|SIDCC|SSID|HSID|SID|LOGIN_INFO|VISITOR_INFO1_LIVE|YSC|PREF)\w*)=[^;,\s"'\\]+/g;

const RULES: [RegExp, string][] = [
  // A whole header line, however it is quoted: "cookie: ...", cookie: ...,
  // 'authorization': '...'. The name survives so a log still says what was
  // dropped, and the value stops at a quote so a JSON log entry is still
  // JSON afterwards (the bug report re-parses what it scrubbed).
  [/(["']?\b(?:set-)?cookie["']?\s*[:=]\s*["']?)[^\n\r"']*/gi, `$1${REDACTED}`],
  [/(["']?authorization["']?\s*[:=]\s*["']?)[^\n\r"']*/gi, `$1${REDACTED}`],
  [/(["']?x-goog-(?:authuser|visitor-id|pageid)["']?\s*[:=]\s*["']?)[^\n\r"']*/gi, `$1${REDACTED}`],
  // A cookie on its own, out of any line: one pasted into a form field, one
  // inside a JSON blob.
  [SESSION_COOKIE_RE, `$1=${REDACTED}`],
  // What YouTube Music actually signs its requests with.
  [/\bSAPISIDHASH\s+\S+/gi, `SAPISIDHASH ${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, `Bearer ${REDACTED}`],
  // Google OAuth, by field name, however it is quoted or encoded: a token
  // response, a form body, a query string.
  [
    /(["']?\b(?:access_token|refresh_token|id_token|device_code|client_secret|accessToken|refreshToken|idToken|deviceCode|clientSecret)["']?\s*[:=]\s*["']?)[^\s"'&,;}]*/g,
    `$1${REDACTED}`,
  ],
  [/([?&]token=)[^\s&"']*/gi, `$1${REDACTED}`],
  // And by shape, for one with no name beside it: an access token (ya29.),
  // a refresh token (1//), a device code (AH-1N...), a client secret
  // (GOCSPX-).
  [/\bya29\.[A-Za-z0-9\-_.]+/g, REDACTED],
  [/(^|[^A-Za-z0-9:])1\/\/[A-Za-z0-9\-_]{8,}/g, `$1${REDACTED}`],
  [/\bAH-1N[A-Za-z0-9\-_]{8,}/g, REDACTED],
  [/\bGOCSPX-[A-Za-z0-9\-_]+/g, REDACTED],
];

/** Every credential this app can see, replaced by a marker. `marker` exists
 *  because the log scrubber writes `[scrubbed]` everywhere else and one word
 *  for one idea is worth more than a distinction nobody reading a log needs. */
export function redactSecrets(text: string, marker = REDACTED): string {
  let out = text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement.replace(REDACTED, marker));
  return out;
}

/** Does this text still hold something that looks like a credential? Used by
 *  the tests, and by anything that would rather refuse than risk it. */
export function hasSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}
