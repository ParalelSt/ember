// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VERIFICATION_URL,
  GoogleError,
  googleConfig,
  pollToken,
  readLikedMusic,
  requestDeviceCode,
  revokeTokens,
  type GoogleConfig,
} from '@/lib/import/google/client';
import {
  FAKE_ACCESS,
  FAKE_API,
  FAKE_DEVICE,
  FAKE_ENV,
  FAKE_OAUTH,
  FAKE_REFRESH,
  FAKE_SECRET,
  FAKE_USER_CODE,
  fakeGoogle,
  music,
  SECRET_MARK,
} from '@/test-utils/fakeGoogle';

const cfg = googleConfig(FAKE_ENV as unknown as NodeJS.ProcessEnv) as GoogleConfig;

function useGoogle(opts: Parameters<typeof fakeGoogle>[0] = {}) {
  const g = fakeGoogle(opts);
  vi.stubGlobal('fetch', vi.fn(g.fetch));
  return g;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('googleConfig', () => {
  it('is null unless both halves of the client are there', () => {
    expect(googleConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(googleConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(googleConfig({ GOOGLE_OAUTH_CLIENT_SECRET: 'y' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(googleConfig({ GOOGLE_OAUTH_CLIENT_ID: ' ', GOOGLE_OAUTH_CLIENT_SECRET: 'y' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("defaults to Google's own endpoints, and takes an override for a fake", () => {
    const real = googleConfig({ GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'y' } as unknown as NodeJS.ProcessEnv);
    expect(real).toMatchObject({ oauthBase: 'https://oauth2.googleapis.com', apiBase: 'https://www.googleapis.com/youtube/v3' });
    expect(googleConfig({ ...FAKE_ENV, GOOGLE_OAUTH_BASE: `${FAKE_OAUTH}/` } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      oauthBase: FAKE_OAUTH,
      apiBase: FAKE_API,
    });
  });
});

describe('requestDeviceCode', () => {
  it('asks for youtube.readonly only, with the client id and never the secret', async () => {
    const g = useGoogle();
    const code = await requestDeviceCode(cfg);
    expect(code).toEqual({
      deviceCode: FAKE_DEVICE,
      userCode: FAKE_USER_CODE,
      verificationUrl: 'https://www.google.com/device',
      expiresIn: 1800,
      interval: 5,
    });
    const body = new URLSearchParams(g.requests[0].body);
    expect(body.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(body.get('client_id')).toBe(FAKE_ENV.GOOGLE_OAUTH_CLIENT_ID);
    expect(g.requests[0].body).not.toContain(FAKE_SECRET);
  });

  it('a verification URL that is not a web address falls back to google.com/device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ device_code: 'd', user_code: 'u', verification_url: 'javascript:alert(1)' })),
    );
    expect((await requestDeviceCode(cfg)).verificationUrl).toBe(DEFAULT_VERIFICATION_URL);
  });

  it('turns each refusal into the one word the routes know', async () => {
    useGoogle({ deviceError: { error: 'invalid_client', status: 401 } });
    await expect(requestDeviceCode(cfg)).rejects.toMatchObject({ reason: 'setupWrong' });
    useGoogle({ deviceError: { error: 'rate_limit_exceeded', status: 403 } });
    await expect(requestDeviceCode(cfg)).rejects.toMatchObject({ reason: 'busy' });
    useGoogle({ deviceError: { error: 'backend', status: 503 } });
    await expect(requestDeviceCode(cfg)).rejects.toMatchObject({ reason: 'unreachable' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(requestDeviceCode(cfg)).rejects.toBeInstanceOf(GoogleError);
  });
});

describe('pollToken', () => {
  const cases: [string, number, unknown][] = [
    ['authorization_pending', 428, { kind: 'pending' }],
    ['slow_down', 403, { kind: 'slow_down' }],
    ['access_denied', 403, { kind: 'fail', reason: 'denied' }],
    ['expired_token', 400, { kind: 'fail', reason: 'expired' }],
    ['invalid_grant', 400, { kind: 'fail', reason: 'expired' }],
    ['org_internal', 403, { kind: 'fail', reason: 'blocked' }],
    ['admin_policy_enforced', 400, { kind: 'fail', reason: 'blocked' }],
    ['unsupported_grant_type', 400, { kind: 'fail', reason: 'setupWrong' }],
    ['something_new', 500, { kind: 'transient' }],
  ];
  for (const [error, status, expected] of cases) {
    it(`${error} is ${JSON.stringify(expected)}`, async () => {
      useGoogle({ polls: [{ error, status }] });
      expect(await pollToken(cfg, FAKE_DEVICE)).toEqual(expected);
    });
  }

  it('sends the device grant with the secret, and hands back both tokens', async () => {
    const g = useGoogle();
    expect(await pollToken(cfg, FAKE_DEVICE)).toEqual({
      kind: 'token',
      accessToken: FAKE_ACCESS,
      refreshToken: FAKE_REFRESH,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
    });
    const body = new URLSearchParams(g.requests[0].body);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(body.get('device_code')).toBe(FAKE_DEVICE);
  });

  it('a network failure is a hiccup, not an ending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await pollToken(cfg, FAKE_DEVICE)).toEqual({ kind: 'transient' });
  });
});

describe('revokeTokens', () => {
  it('revokes the refresh token, in the body rather than the URL', async () => {
    const g = useGoogle();
    expect(await revokeTokens(cfg, { accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH })).toBe(true);
    expect(g.revoked).toEqual([FAKE_REFRESH]);
    expect(g.requests[0].url).toBe(`${FAKE_OAUTH}/revoke`);
    expect(g.requests[0].url).not.toContain(SECRET_MARK);
  });

  it('falls back to the access token, and never throws', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        const token = new URLSearchParams(String(init.body)).get('token') ?? '';
        calls.push(token);
        if (token === FAKE_REFRESH) throw new TypeError('fetch failed');
        return new Response('', { status: 200 });
      }),
    );
    expect(await revokeTokens(cfg, { accessToken: FAKE_ACCESS, refreshToken: FAKE_REFRESH })).toBe(true);
    expect(calls).toEqual([FAKE_REFRESH, FAKE_ACCESS]);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('down'))));
    expect(await revokeTokens(cfg, { accessToken: FAKE_ACCESS, refreshToken: null })).toBe(false);
  });
});

describe('readLikedMusic', () => {
  const page = (from: number, n: number, category = '10') =>
    Array.from({ length: n }, (_, i) => music(`v${String(from + i).padStart(10, '0')}`, `Song ${from + i}`, 'Band', category));

  it('asks for likes with the token, pages to the end, keeps the order', async () => {
    const g = useGoogle({ pages: [page(0, 50), page(50, 50), page(100, 7)] });
    const r = await readLikedMusic(cfg, FAKE_ACCESS);
    expect(r.songs).toHaveLength(107);
    expect(r.songs[0].track.title).toBe('Song 0');
    expect(r.songs[106].track.title).toBe('Song 106');
    expect(r.truncated).toBe(false);
    expect(g.requests).toHaveLength(3);
    const q = new URL(g.requests[0].url).searchParams;
    expect(q.get('myRating')).toBe('like');
    expect(q.get('part')).toBe('snippet,contentDetails');
    expect(q.get('maxResults')).toBe('50');
    expect(new URL(g.requests[1].url).searchParams.get('pageToken')).toBe('1');
    expect(g.requests.every((r) => r.authorization === `Bearer ${FAKE_ACCESS}`)).toBe(true);
    // The token is a header, never part of the address.
    expect(g.requests.some((r) => r.url.includes(SECRET_MARK))).toBe(false);
  });

  it('keeps only music and counts the rest', async () => {
    useGoogle({ pages: [[...page(0, 3), ...page(3, 2, '20')], [music('topic000001', 'Topic song', 'Singer - Topic', '24')]] });
    const r = await readLikedMusic(cfg, FAKE_ACCESS);
    expect(r.songs.map((s) => s.track.title)).toEqual(['Song 0', 'Song 1', 'Song 2', 'Topic song']);
    expect(r.skipped).toBe(2);
  });

  it('stops at the cap and says there was more', async () => {
    const g = useGoogle({ pages: [page(0, 50), page(50, 50), page(100, 50)] });
    const r = await readLikedMusic(cfg, FAKE_ACCESS, { cap: 60 });
    expect(r.songs).toHaveLength(60);
    expect(r.songs[59].track.title).toBe('Song 59');
    expect(r.truncated).toBe(true);
    // No page read past the one that crossed the cap.
    expect(g.requests).toHaveLength(2);
  });

  it('exactly the cap is not more than the cap', async () => {
    useGoogle({ pages: [page(0, 50), page(50, 10)] });
    const r = await readLikedMusic(cfg, FAKE_ACCESS, { cap: 60 });
    expect(r.songs).toHaveLength(60);
    expect(r.truncated).toBe(false);
  });

  it('stops after the most pages Ember reads, and says there was more', async () => {
    const g = useGoogle({ pages: [page(0, 50, '20'), page(50, 50, '20'), page(100, 50)] });
    const r = await readLikedMusic(cfg, FAKE_ACCESS, { maxPages: 2 });
    expect(r.songs).toHaveLength(0);
    expect(r.skipped).toBe(100);
    expect(r.truncated).toBe(true);
    expect(g.requests).toHaveLength(2);
  });

  it('a used-up quota, a missing scope and a broken API each say so', async () => {
    useGoogle({ videosError: { status: 403, reason: 'quotaExceeded' } });
    await expect(readLikedMusic(cfg, FAKE_ACCESS)).rejects.toMatchObject({ reason: 'quota' });
    useGoogle({ videosError: { status: 403, reason: 'insufficientPermissions' } });
    await expect(readLikedMusic(cfg, FAKE_ACCESS)).rejects.toMatchObject({ reason: 'noScope' });
    useGoogle({ videosError: { status: 403, reason: 'accessNotConfigured' } });
    await expect(readLikedMusic(cfg, FAKE_ACCESS)).rejects.toMatchObject({ reason: 'setupWrong' });
    useGoogle({ videosError: { status: 503, reason: 'backendError' } });
    await expect(readLikedMusic(cfg, FAKE_ACCESS)).rejects.toMatchObject({ reason: 'unreachable' });
    useGoogle({ videosError: { status: 401, reason: 'authError' } });
    const e = await readLikedMusic(cfg, FAKE_ACCESS).catch((x: unknown) => x);
    expect(e).toMatchObject({ reason: 'readFailed' });
    expect(String((e as Error).message)).not.toContain(SECRET_MARK);
  });
});
