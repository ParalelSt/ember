/** Take the credentials out of any text before it is written down.
 *
 *  A transfer from YouTube Music asks the person to paste the request headers
 *  of their own signed-in tab: a Cookie line that is, for two years, their
 *  Google session. Ember holds it for one `player.py liked` call and never
 *  stores it, but a stray log line, a Discord bug report or an error message
 *  quoting the input would outlive the call. So everything that could carry
 *  it goes through here first: the python helper's stderr, every server log
 *  entry (lib/logger/sanitize.ts), and the sentence a failed transfer answers
 *  with.
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
