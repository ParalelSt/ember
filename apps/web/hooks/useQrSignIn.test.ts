import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BACKOFF_MS, MAX_RENEWALS, POLL_MS, useQrSignIn } from './useQrSignIn';

/** The new device's side of QR sign-in (plan 1a): start a request, poll
 *  every 2 s with jitter while visible, renew silently up to 5 times, back
 *  off on errors, stop when hidden. */

let visibility: DocumentVisibilityState = 'visible';
let startCount = 0;
let statusCalls = 0;
let statusAnswers: Array<() => Response> = [];
const startBodies: unknown[] = [];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setVisible(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  startCount = 0;
  statusCalls = 0;
  statusAnswers = [];
  startBodies.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/qr/start')) {
      startCount++;
      startBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonRes({
        id: `req${String(startCount).padStart(12, '0')}`,
        code: 'ABCDEFGH',
        approveUrl: `https://ember.example/link/${'t'.repeat(42)}${startCount}`,
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
        device: 'Ember on Android Automotive',
      });
    }
    if (url.endsWith('/api/auth/qr/status')) {
      statusCalls++;
      const next = statusAnswers.shift();
      return next ? next() : jsonRes({ status: 'pending' });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(onApproved = vi.fn()) {
  const hook = renderHook(() => useQrSignIn({ shell: 'capacitor', onApproved }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { ...hook, onApproved };
}
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

describe('useQrSignIn', () => {
  it('starts a request with the shell hint and waits', async () => {
    const { result } = await mount();
    expect(startCount).toBe(1);
    expect(startBodies[0]).toEqual({ shell: 'capacitor' });
    expect(result.current.state).toMatchObject({ kind: 'waiting', code: 'ABCDEFGH', device: 'Ember on Android Automotive', offline: false });
  });

  it('polls every 2 s with a little jitter', async () => {
    await mount();
    await advance(POLL_MS - 1);
    expect(statusCalls).toBe(0);
    await advance(400);
    expect(statusCalls).toBe(1);
    await advance(POLL_MS + 400);
    expect(statusCalls).toBe(2);
  });

  it('hands the session over on approval and stops polling', async () => {
    statusAnswers.push(() => jsonRes({ status: 'approved', token: 'tok', record: { id: 'u1', name: 'Robin', email: 'r@x' } }));
    const { result, onApproved } = await mount();
    await advance(POLL_MS + 400);
    expect(onApproved).toHaveBeenCalledWith('tok', { id: 'u1', name: 'Robin', email: 'r@x' });
    expect(result.current.state).toEqual({ kind: 'approved', name: 'Robin' });
    const calls = statusCalls;
    await advance(20_000);
    expect(statusCalls).toBe(calls);
    expect(onApproved).toHaveBeenCalledTimes(1);
  });

  it('stops while the tab is hidden and goes on when it is back', async () => {
    await mount();
    await advance(POLL_MS + 400);
    expect(statusCalls).toBe(1);
    await act(async () => setVisible('hidden'));
    await advance(30_000);
    expect(statusCalls).toBe(1);
    await act(async () => setVisible('visible'));
    await advance(POLL_MS + 400);
    expect(statusCalls).toBe(2);
  });

  it('renews silently up to 5 times, then says expired; Get a new code starts over', async () => {
    const { result } = await mount();
    for (let i = 0; i < MAX_RENEWALS; i++) {
      statusAnswers.push(() => jsonRes({ status: 'expired' }));
      await advance(POLL_MS + 400);
      expect(result.current.state.kind).toBe('waiting');
    }
    expect(startCount).toBe(1 + MAX_RENEWALS);
    statusAnswers.push(() => jsonRes({ status: 'expired' }));
    await advance(POLL_MS + 400);
    expect(result.current.state).toEqual({ kind: 'expired' });
    expect(startCount).toBe(1 + MAX_RENEWALS);
    await act(async () => {
      result.current.restart();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(startCount).toBe(2 + MAX_RENEWALS);
    expect(result.current.state.kind).toBe('waiting');
  });

  it('renews when the code runs out on the clock, without asking the server', async () => {
    await mount();
    await advance(183_000);
    expect(startCount).toBe(2);
  });

  it('a 404 (cookie gone, request swept) is treated like expired', async () => {
    statusAnswers.push(() => jsonRes({ error: 'No sign-in request with that code.' }, 404));
    await mount();
    await advance(POLL_MS + 400);
    expect(startCount).toBe(2);
  });

  it('backs off to 5 s and says so when Ember cannot be reached', async () => {
    statusAnswers.push(() => jsonRes({ error: 'down' }, 503));
    const { result } = await mount();
    await advance(POLL_MS + 400);
    expect(statusCalls).toBe(1);
    expect(result.current.state).toMatchObject({ kind: 'waiting', offline: true });
    await advance(POLL_MS + 400);
    expect(statusCalls).toBe(1);
    // The failure came at 2.0 to 2.3 s, so the retry is due by 7.6 s.
    await advance(BACKOFF_MS - POLL_MS + 200);
    expect(statusCalls).toBe(2);
    expect(result.current.state).toMatchObject({ kind: 'waiting', offline: false });
  });

  it('a network failure backs off the same way', async () => {
    statusAnswers.push(() => { throw new TypeError('Failed to fetch'); });
    const { result } = await mount();
    await advance(POLL_MS + 400);
    expect(result.current.state).toMatchObject({ kind: 'waiting', offline: true });
  });

  it('says declined after Not me, and Try again starts a new request', async () => {
    statusAnswers.push(() => jsonRes({ status: 'denied' }));
    const { result } = await mount();
    await advance(POLL_MS + 400);
    expect(result.current.state).toEqual({ kind: 'denied' });
    await act(async () => {
      result.current.restart();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(startCount).toBe(2);
  });

  it('a start that fails (or answers junk) is an error state, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ status: 'existing' })));
    const { result } = await mount();
    expect(result.current.state).toEqual({ kind: 'error' });
  });
});
