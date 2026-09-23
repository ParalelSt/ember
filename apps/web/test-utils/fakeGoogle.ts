/** A stand-in for Google's device flow and the YouTube Data API, as a fetch
 *  function: device/code, token, revoke and videos?myRating=like. Every
 *  request is recorded so a test can prove what was sent and revoked. The
 *  tokens are invented but shaped like Google's, so the redaction rules
 *  recognise them. */

import type { YoutubeVideo } from '@/lib/import/google/likes';

export const FAKE_OAUTH = 'http://fake-google.test/oauth';
export const FAKE_API = 'http://fake-google.test/youtube/v3';
export const FAKE_ACCESS = 'ya29.fakeS3cr3tAccessTokenValue';
export const FAKE_REFRESH = '1//0fakeS3cr3tRefreshTokenValue';
export const FAKE_DEVICE = 'AH-1NgfakeS3cr3tDeviceCodeValue';
export const FAKE_SECRET = 'GOCSPX-fakeS3cr3tClientSecret';
export const FAKE_USER_CODE = 'WXYZ-QRST';
/** Any of these in a response, a log or a thrown error is a leak. */
export const SECRET_MARK = 'S3cr3t';

export interface FakeGoogleOptions {
  /** What each token poll answers, in order; the last one repeats. */
  polls?: ({ error: string; status?: number } | 'token')[];
  /** The scope the token comes back with. */
  scope?: string;
  /** Pages of likes, in order. */
  pages?: YoutubeVideo[][];
  /** Answer device/code with this error instead. */
  deviceError?: { error: string; status: number };
  /** Answer videos with this error instead. */
  videosError?: { status: number; reason: string };
  interval?: number;
  expiresIn?: number;
}

export interface FakeRequest {
  url: string;
  method: string;
  body: string;
  authorization: string | null;
}

export function music(id: string, title: string, channel = 'An Artist', categoryId = '10', duration = 'PT3M20S'): YoutubeVideo {
  return {
    id,
    snippet: { title, channelTitle: channel, categoryId, thumbnails: { high: { url: `https://i.ytimg.test/${id}/hq.jpg` } } },
    contentDetails: { duration },
  };
}

export function fakeGoogle(opts: FakeGoogleOptions = {}) {
  const requests: FakeRequest[] = [];
  const revoked: string[] = [];
  let poll = 0;
  const polls = opts.polls ?? ['token'];
  const pages = opts.pages ?? [[music('aaaaaaaaaaa', 'First Song')]];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? init.body : '';
    requests.push({ url, method: init.method ?? 'GET', body, authorization: headers.get('authorization') });
    const form = new URLSearchParams(body);

    if (url === `${FAKE_OAUTH}/device/code`) {
      if (opts.deviceError) return json({ error: opts.deviceError.error }, opts.deviceError.status);
      return json({
        device_code: FAKE_DEVICE,
        user_code: FAKE_USER_CODE,
        verification_url: 'https://www.google.com/device',
        expires_in: opts.expiresIn ?? 1800,
        interval: opts.interval ?? 5,
      });
    }
    if (url === `${FAKE_OAUTH}/token`) {
      if (form.get('device_code') !== FAKE_DEVICE || form.get('client_secret') !== FAKE_SECRET) {
        return json({ error: 'invalid_client' }, 401);
      }
      const answer = polls[Math.min(poll++, polls.length - 1)];
      if (answer === 'token') {
        return json({
          access_token: FAKE_ACCESS,
          refresh_token: FAKE_REFRESH,
          expires_in: 3599,
          scope: opts.scope ?? 'https://www.googleapis.com/auth/youtube.readonly',
          token_type: 'Bearer',
        });
      }
      return json({ error: answer.error }, answer.status ?? 428);
    }
    if (url === `${FAKE_OAUTH}/revoke`) {
      revoked.push(form.get('token') ?? '');
      return new Response('', { status: 200 });
    }
    if (url.startsWith(`${FAKE_API}/videos?`)) {
      if (headers.get('authorization') !== `Bearer ${FAKE_ACCESS}` || revoked.length) {
        return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
      }
      if (opts.videosError) {
        return json({ error: { code: opts.videosError.status, errors: [{ reason: opts.videosError.reason }] } }, opts.videosError.status);
      }
      const q = new URL(url).searchParams;
      const index = Number(q.get('pageToken') ?? '0');
      const items = pages[index] ?? [];
      return json({ items, ...(index + 1 < pages.length ? { nextPageToken: String(index + 1) } : {}) });
    }
    return new Response('not found', { status: 404 });
  };

  return {
    fetch: fetchImpl,
    requests,
    revoked,
    get polls() {
      return poll;
    },
  };
}

export const FAKE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: FAKE_SECRET,
  GOOGLE_OAUTH_BASE: FAKE_OAUTH,
  YOUTUBE_API_BASE: FAKE_API,
};
