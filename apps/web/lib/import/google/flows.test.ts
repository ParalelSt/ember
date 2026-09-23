// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleConfig, type GoogleConfig } from '@/lib/import/google/client';
import {
  _flowStats,
  _resetFlows,
  beginFlow,
  cancelFlow,
  ENDED_GRACE_MS,
  FLOW_TTL_MS,
  FlowError,
  flowStatus,
  MAX_FLOWS,
  takeFlow,
} from '@/lib/import/google/flows';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';
import { FAKE_ENV, FAKE_REFRESH, FAKE_USER_CODE, fakeGoogle, music, SECRET_MARK } from '@/test-utils/fakeGoogle';

// A sign-in's whole life against a fake Google, with the clock faked: the
// server polls at Google's interval, reads the likes once, revokes the grant
// at once, and forgets everything on every way out.

const cfg = googleConfig(FAKE_ENV as unknown as NodeJS.ProcessEnv) as GoogleConfig;

function useGoogle(opts: Parameters<typeof fakeGoogle>[0] = {}) {
  const g = fakeGoogle(opts);
  vi.stubGlobal('fetch', vi.fn(g.fetch));
  return g;
}

const pending = { error: 'authorization_pending', status: 428 };
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  _resetFlows();
});
afterEach(() => {
  _resetFlows();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a sign-in that goes well', () => {
  it('waits, reads, revokes at once, and shows the preview', async () => {
    const g = useGoogle({
      polls: [pending, pending, 'token'],
      pages: [[music('aaaaaaaaaaa', 'First'), music('bbbbbbbbbbb', 'A vlog', 'Me', '22')], [music('ccccccccccc', 'Second', 'Band - Topic', '24')]],
    });
    const started = await beginFlow('u1', cfg);
    expect(started).toMatchObject({ userCode: FAKE_USER_CODE, verificationUrl: 'https://www.google.com/device', interval: 5 });
    // Google's codes last half an hour; Ember's sign-in a quarter.
    expect(started.expiresIn).toBe(FLOW_TTL_MS / 1000);
    expect(started.flowId).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(JSON.stringify(started)).not.toContain(SECRET_MARK);

    expect(flowStatus('u1', started.flowId)).toEqual({ state: 'waiting' });
    expect(_flowStats()).toEqual({ flows: 1, holdingSecrets: 1 });

    // Not a poll before the interval Google asked for.
    await tick(4_900);
    expect(g.polls).toBe(0);
    await tick(100);
    expect(g.polls).toBe(1);
    await tick(5_000);
    expect(g.polls).toBe(2);
    expect(flowStatus('u1', started.flowId)?.state).toBe('waiting');
    await tick(5_000);

    const status = flowStatus('u1', started.flowId)!;
    expect(status.state).toBe('ready');
    expect(status.preview).toMatchObject({
      kind: 'ytmusic-liked',
      label: 'Liked songs from YouTube Music',
      order: 'newest-first',
      // Every like, the vlog too: YouTube Music says which are songs during
      // the transfer. The Topic one is known already, so two wait for it.
      count: 3,
      toCheck: 2,
      truncated: false,
      sample: [
        { title: 'First', artist: 'An Artist' },
        { title: 'A vlog', artist: 'Me' },
        { title: 'Second', artist: 'Band' },
      ],
    });
    // Read, then signed out, and nothing secret left in memory.
    expect(g.revoked).toEqual([FAKE_REFRESH]);
    expect(_flowStats()).toEqual({ flows: 1, holdingSecrets: 0 });
    expect(JSON.stringify(status)).not.toContain(SECRET_MARK);
  });

  it('Start takes the songs once, each with its real video as a ready candidate', async () => {
    useGoogle({ pages: [[music('aaaaaaaaaaa', 'First'), music('bbbbbbbbbbb', 'Second')]] });
    const { flowId } = await beginFlow('u1', cfg);
    await tick(5_000);
    const parsed = takeFlow('u1', flowId)!;
    expect(parsed.items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(parsed.items[0].candidates?.[0]).toMatchObject({ score: 100, unchecked: true, track: { sourceId: 'aaaaaaaaaaa' } });
    expect(takeFlow('u1', flowId)).toBeNull();
    expect(flowStatus('u1', flowId)).toBeNull();
    expect(_flowStats().flows).toBe(0);
  });

  it('slow_down stretches the interval by five seconds', async () => {
    const g = useGoogle({ polls: [{ error: 'slow_down', status: 403 }, pending, 'token'] });
    const { flowId } = await beginFlow('u1', cfg);
    await tick(5_000);
    expect(g.polls).toBe(1);
    await tick(9_000);
    expect(g.polls).toBe(1);
    await tick(1_000);
    expect(g.polls).toBe(2);
    await tick(10_000);
    expect(flowStatus('u1', flowId)?.state).toBe('ready');
  });

  it('a ready sign-in waits a fresh quarter of an hour for Start, then goes', async () => {
    // Allowed on the 168th poll: 14 minutes in.
    useGoogle({ polls: [...Array.from({ length: 167 }, () => pending), 'token'] });
    const { flowId } = await beginFlow('u1', cfg);
    await tick(14 * 60_000 - 1);
    expect(flowStatus('u1', flowId)?.state).toBe('waiting');
    await tick(1);
    expect(flowStatus('u1', flowId)?.state).toBe('ready');
    // Ready near the end of the first quarter hour, and the first quarter
    // hour's end does not take it...
    await tick(FLOW_TTL_MS - 60_000);
    expect(flowStatus('u1', flowId)?.state).toBe('ready');
    await tick(60_000);
    expect(flowStatus('u1', flowId)).toBeNull();
  });
});

describe('every way a sign-in ends early forgets it', () => {
  const endings: [string, Parameters<typeof fakeGoogle>[0], string, string][] = [
    ['a no on Google\'s page', { polls: [{ error: 'access_denied', status: 403 }] }, 'denied', GOOGLE_MESSAGES.denied],
    ['a code Google says ran out', { polls: [{ error: 'expired_token', status: 400 }] }, 'expired', GOOGLE_MESSAGES.expired],
    ['an account Google blocks', { polls: [{ error: 'org_internal', status: 403 }] }, 'error', GOOGLE_MESSAGES.blocked],
    ['the one scope unticked', { scope: 'openid' }, 'denied', GOOGLE_MESSAGES.noScope],
    ['a used-up quota', { videosError: { status: 403, reason: 'quotaExceeded' } }, 'error', GOOGLE_MESSAGES.quota],
    ['an account with no likes at all', { pages: [[]] }, 'error', GOOGLE_MESSAGES.noLikes],
  ];
  for (const [name, opts, state, message] of endings) {
    it(`${name}: "${state}", with its sentence, and nothing kept`, async () => {
      const g = useGoogle(opts);
      const { flowId } = await beginFlow('u1', cfg);
      await tick(5_000);
      const status = flowStatus('u1', flowId)!;
      expect(status.state).toBe(state);
      expect(status.message).toContain(message);
      expect(status.preview).toBeUndefined();
      expect(_flowStats().holdingSecrets).toBe(0);
      // A token that was handed out is revoked, whatever went wrong after.
      if (g.requests.some((r) => r.url.includes('/token')) && !opts?.polls) expect(g.revoked).toEqual([FAKE_REFRESH]);
      // It still says how it ended for a little while, then it is gone.
      await tick(ENDED_GRACE_MS);
      expect(flowStatus('u1', flowId)).toBeNull();
    });
  }

  it('Ember gives up at a quarter of an hour, before Google does', async () => {
    const g = useGoogle({ polls: [pending] });
    const { flowId } = await beginFlow('u1', cfg);
    await tick(FLOW_TTL_MS);
    expect(flowStatus('u1', flowId)).toEqual({ state: 'expired', message: GOOGLE_MESSAGES.expired });
    expect(_flowStats().holdingSecrets).toBe(0);
    const polls = g.polls;
    await tick(60_000);
    expect(g.polls).toBe(polls);
  });

  it('Google being down five polls in a row is an error, not a wait forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/device/code')) {
          return Response.json({ device_code: 'AH-1Ngx', user_code: 'ABCD-EFGH', interval: 5, expires_in: 1800 });
        }
        throw new TypeError('fetch failed');
      }),
    );
    const { flowId } = await beginFlow('u1', cfg);
    await tick(4 * 5_000);
    expect(flowStatus('u1', flowId)?.state).toBe('waiting');
    await tick(5_000);
    expect(flowStatus('u1', flowId)).toEqual({ state: 'error', message: GOOGLE_MESSAGES.unreachable });
  });

  it('cancel stops the polling and nothing is left', async () => {
    const g = useGoogle({ polls: [pending] });
    const { flowId } = await beginFlow('u1', cfg);
    await tick(5_000);
    expect(await cancelFlow('u1', flowId)).toBe(true);
    const polls = g.polls;
    await tick(60_000);
    expect(g.polls).toBe(polls);
    expect(flowStatus('u1', flowId)).toBeNull();
    expect(_flowStats()).toEqual({ flows: 0, holdingSecrets: 0 });
  });

  it('cancel while the likes are being read revokes the token and drops the result', async () => {
    const g = fakeGoogle();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/videos?')) await gate;
        return g.fetch(url, init);
      }),
    );
    const { flowId } = await beginFlow('u1', cfg);
    await tick(5_000);
    expect(flowStatus('u1', flowId)?.state).toBe('reading');
    await cancelFlow('u1', flowId);
    expect(g.revoked).toEqual([FAKE_REFRESH]);
    release();
    await tick(0);
    expect(flowStatus('u1', flowId)).toBeNull();
    expect(_flowStats()).toEqual({ flows: 0, holdingSecrets: 0 });
  });
});

describe('whose sign-in it is', () => {
  it('nobody else can see it, take it or cancel it', async () => {
    useGoogle();
    const { flowId } = await beginFlow('u1', cfg);
    await tick(5_000);
    expect(flowStatus('u2', flowId)).toBeNull();
    expect(takeFlow('u2', flowId)).toBeNull();
    expect(await cancelFlow('u2', flowId)).toBe(false);
    expect(flowStatus('u1', flowId)?.state).toBe('ready');
  });

  it('a second sign-in by the same person replaces the first', async () => {
    useGoogle({ polls: [pending] });
    const first = await beginFlow('u1', cfg);
    const second = await beginFlow('u1', cfg);
    expect(flowStatus('u1', first.flowId)).toBeNull();
    expect(flowStatus('u1', second.flowId)?.state).toBe('waiting');
    expect(_flowStats().flows).toBe(1);
  });

  it('there is a ceiling on sign-ins at once', async () => {
    useGoogle({ polls: [pending] });
    for (let i = 0; i < MAX_FLOWS; i++) await beginFlow(`u${i}`, cfg);
    await expect(beginFlow('one-more', cfg)).rejects.toMatchObject({ reason: 'busy', status: 503 });
  });

  it('a refusal at the first step is a FlowError with its sentence', async () => {
    useGoogle({ deviceError: { error: 'invalid_client', status: 401 } });
    const e = await beginFlow('u1', cfg).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FlowError);
    expect(e).toMatchObject({ reason: 'setupWrong', status: 503, message: GOOGLE_MESSAGES.setupWrong });
    expect(_flowStats().flows).toBe(0);
  });
});
