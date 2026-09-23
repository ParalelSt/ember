import { describe, it, expect } from 'vitest';
import { hasSecret, redactSecrets, REDACTED } from '@/lib/import/redact';
import { scrubText } from '@/lib/logger/sanitize';

// A transfer from YouTube Music puts somebody's Google session through this
// app for the length of one call. What is checked here is that no shape of it
// survives into anything written down: a log line, a bug report, an error
// message. The values below are invented but named exactly as Google's are.

const SAPISID = 's3cr3tSAPISIDvalue';
const THREE_P = 's3cr3t3PAPISIDvalue';
const COOKIE_LINE = `cookie: SAPISID=${SAPISID}; __Secure-3PAPISID=${THREE_P}; __Secure-1PSIDTS=s3cr3tPSIDTS; HSID=s3cr3tHSID; LOGIN_INFO=s3cr3tLOGIN`;
const HEADERS = [
  'accept: */*',
  'authorization: SAPISIDHASH 1758500000_s3cr3thashvalue',
  COOKIE_LINE,
  'user-agent: Mozilla/5.0',
  'x-goog-authuser: 0',
].join('\n');
const SECRET_PARTS = [SAPISID, THREE_P, 's3cr3tPSIDTS', 's3cr3tHSID', 's3cr3tLOGIN', 's3cr3thashvalue'];

const leaks = (text: string) => SECRET_PARTS.filter((p) => text.includes(p));

describe('redactSecrets', () => {
  it('leaves a whole pasted header block with nothing to take', () => {
    expect(leaks(redactSecrets(HEADERS))).toEqual([]);
  });

  it('keeps the header names, so a log still says what was dropped', () => {
    const out = redactSecrets(HEADERS);
    expect(out).toContain('cookie:');
    expect(out).toContain(REDACTED);
    expect(out).toContain('user-agent: Mozilla/5.0');
  });

  it('takes a cookie out of a line that only mentions one', () => {
    expect(redactSecrets(`python failed: SAPISID=${SAPISID} was rejected`)).toBe(
      `python failed: SAPISID=${REDACTED} was rejected`,
    );
  });

  it('takes it out of JSON too, however it was quoted', () => {
    const json = JSON.stringify({ headers: { cookie: COOKIE_LINE, authorization: `SAPISIDHASH 1_${SAPISID}` } });
    expect(leaks(redactSecrets(json))).toEqual([]);
  });

  it('covers every Google session cookie name, not just the two obvious ones', () => {
    const names = [
      'SAPISID',
      'APISID',
      'HSID',
      'SSID',
      'SID',
      '__Secure-1PSID',
      '__Secure-3PSID',
      '__Secure-3PAPISID',
      '__Secure-1PSIDTS',
      '__Secure-3PSIDCC',
      'LOGIN_INFO',
      'VISITOR_INFO1_LIVE',
    ];
    const line = names.map((n) => `${n}=s3cr3t-${n}`).join('; ');
    expect(redactSecrets(line)).not.toContain('s3cr3t');
  });

  it('takes a bearer token and a SAPISIDHASH', () => {
    expect(redactSecrets('Authorization: Bearer ya29.a0AfB_s3cr3ttoken')).not.toContain('s3cr3t');
    expect(redactSecrets('authorization value SAPISIDHASH 17585_s3cr3thashvalue')).not.toContain('s3cr3t');
  });

  it('leaves ordinary text and ordinary log lines alone', () => {
    const line = '[import] job jx1 accepted 12 of 40, next batch at position 12';
    expect(redactSecrets(line)).toBe(line);
    expect(redactSecrets('title: Cookie Jar, artist: The Sessions')).toBe('title: Cookie Jar, artist: The Sessions');
  });

  it('hasSecret says whether anything was found', () => {
    expect(hasSecret(COOKIE_LINE)).toBe(true);
    expect(hasSecret('nothing to see here')).toBe(false);
  });
});

describe('scrubText, the door every log entry and bug report goes through', () => {
  it('runs the credential rules too, so a pasted session never reaches Discord', () => {
    expect(leaks(scrubText(HEADERS))).toEqual([]);
  });

  it('still scrubs what it scrubbed before', () => {
    expect(scrubText('pb_auth=abcdef.ghijkl')).toContain('pb_auth=[scrubbed]');
    expect(scrubText('bearer aaaaaaaaaaaaaaaa')).toContain('[scrubbed]');
  });
});

// The Google sign-in behind a YouTube Music transfer: an access token, a
// refresh token, a device code and the host's client secret. Invented, but
// shaped exactly as Google's are.
describe('Google sign-in credentials', () => {
  const ACCESS = 'ya29.a0AfH6SMBs3cr3tAccessTokenValue_x-y';
  const REFRESH = '1//0gs3cr3tRefreshTokenValue-abc_def';
  const DEVICE = 'AH-1Ng2s3cr3tDeviceCodeValue_xyz';
  const CLIENT_SECRET = 'GOCSPX-s3cr3tClientSecretValue';
  const gLeaks = (text: string) => ['s3cr3tAccess', 's3cr3tRefresh', 's3cr3tDevice', 's3cr3tClient'].filter((p) => text.includes(p));

  it('takes every one out of a token response, a form body and a query string', () => {
    const json = JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, scope: 'x', token_type: 'Bearer' });
    expect(gLeaks(redactSecrets(json))).toEqual([]);
    // Still JSON afterwards, so a scrubbed log entry re-parses.
    expect(JSON.parse(redactSecrets(json))).toMatchObject({ expires_in: 3599, token_type: 'Bearer' });
    const form = `client_id=abc.apps.googleusercontent.com&client_secret=${CLIENT_SECRET}&device_code=${DEVICE}&grant_type=x`;
    expect(gLeaks(redactSecrets(form))).toEqual([]);
    expect(redactSecrets(form)).toContain('client_id=abc.apps.googleusercontent.com');
    expect(gLeaks(redactSecrets(`POST https://oauth2.googleapis.com/revoke?token=${REFRESH}`))).toEqual([]);
  });

  it('takes them out by shape when nothing names them', () => {
    const line = `poll said ${ACCESS} then ${REFRESH}, code ${DEVICE}, secret ${CLIENT_SECRET}`;
    expect(gLeaks(redactSecrets(line))).toEqual([]);
  });

  it('by camelCase name too, the way the server holds them', () => {
    const held = JSON.stringify({ accessToken: 'plainvalue111', refreshToken: 'plainvalue222', deviceCode: 'plainvalue333' });
    expect(redactSecrets(held)).not.toMatch(/plainvalue/);
  });

  it('leaves a URL and the code a person types alone', () => {
    expect(redactSecrets('open https://www.google.com/device and type ABCD-EFGH')).toBe(
      'open https://www.google.com/device and type ABCD-EFGH',
    );
  });

  it('scrubText and the log walk drop them before a bug report', async () => {
    const { scrub } = await import('@/lib/logger/sanitize');
    expect(gLeaks(scrubText(`token response ${JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH })}`))).toEqual([]);
    const walked = JSON.stringify(scrub({ flow: { accessToken: ACCESS, refresh_token: REFRESH, device_code: DEVICE, clientSecret: CLIENT_SECRET } }));
    expect(gLeaks(walked)).toEqual([]);
  });
});
