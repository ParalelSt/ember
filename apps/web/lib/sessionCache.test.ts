// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ROTATE_AFTER_MS,
  SESSION_CACHE_MAX,
  SESSION_CACHE_TTL_MS,
  _resetSessionCache,
  cachedSession,
  forgetAllSessions,
  forgetUser,
  rememberSession,
  sessionCacheSize,
  shouldRotate,
  tokenExpiry,
  verifySession,
} from './sessionCache';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A JWT-shaped token expiring `secondsLeft` after `now` (ms). */
const jwt = (secondsLeft: number, now = Date.now(), extra: object = {}) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 'u1', type: 'auth', exp: Math.floor(now / 1000) + secondsLeft, ...extra })}.signature`;
const rec = (id = 'u1') => ({ id, collectionId: 'c', collectionName: 'users' });

beforeEach(() => _resetSessionCache());

describe('sessionCache', () => {
  it('reads the expiry, and nothing from a token that is not a JWT', () => {
    const now = 1_800_000_000_000;
    expect(tokenExpiry(jwt(60, now))).toBe(now + 60_000);
    expect(tokenExpiry('token-1')).toBeNull();
    expect(tokenExpiry('a.!!!.c')).toBeNull();
  });

  it('remembers an accepted token for the window, then forgets it', () => {
    const now = Date.now();
    const t = jwt(3600, now);
    rememberSession(t, rec(), now);
    expect(cachedSession(t, now + SESSION_CACHE_TTL_MS - 1)).toEqual(rec());
    expect(cachedSession(t, now + SESSION_CACHE_TTL_MS)).toBeNull();
  });

  it('refuses an expired token, even one it remembers, and never outlives the token', () => {
    const now = Date.now();
    const t = jwt(10, now);
    rememberSession(t, rec(), now);
    expect(cachedSession(t, now + 9_000)).toEqual(rec());
    expect(cachedSession(t, now + 10_000)).toBeNull();
    const dead = jwt(-5, now);
    rememberSession(dead, rec(), now);
    expect(cachedSession(dead, now)).toBeNull();
  });

  it('refuses a tampered token: any changed byte is another key', () => {
    const now = Date.now();
    const t = jwt(3600, now);
    rememberSession(t, rec(), now);
    const [h, p, s] = t.split('.');
    expect(cachedSession(`${h}.${p}.${s}x`, now)).toBeNull();
    // Same claims but a raised admin flag in the payload: different token.
    expect(cachedSession(`${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), is_admin: true })}.${s}`, now)).toBeNull();
  });

  it('does not remember a token whose expiry it cannot read', () => {
    rememberSession('token-1', rec());
    expect(sessionCacheSize()).toBe(0);
  });

  it('stays bounded, dropping the least recently used first', () => {
    const now = Date.now();
    const tokens = Array.from({ length: SESSION_CACHE_MAX + 1 }, (_, i) => jwt(3600, now, { n: i }));
    for (const t of tokens.slice(0, SESSION_CACHE_MAX)) rememberSession(t, rec(), now);
    expect(cachedSession(tokens[0], now)).not.toBeNull(); // used: now the newest
    rememberSession(tokens[SESSION_CACHE_MAX], rec(), now);
    expect(sessionCacheSize()).toBe(SESSION_CACHE_MAX);
    expect(cachedSession(tokens[0], now)).not.toBeNull();
    expect(cachedSession(tokens[1], now)).toBeNull();
  });

  it('forgets one person, or everyone', () => {
    const now = Date.now();
    const a = jwt(3600, now, { n: 1 });
    const a2 = jwt(3600, now, { n: 2 });
    const b = jwt(3600, now, { n: 3 });
    rememberSession(a, rec('alice'), now);
    rememberSession(a2, rec('alice'), now);
    rememberSession(b, rec('bob'), now);
    forgetUser('alice');
    expect(cachedSession(a, now)).toBeNull();
    expect(cachedSession(a2, now)).toBeNull();
    expect(cachedSession(b, now)).not.toBeNull();
    forgetAllSessions();
    expect(cachedSession(b, now)).toBeNull();
  });

  it('asks once for a burst, remembers the old and the new token, and remembers no refusal', async () => {
    const now = Date.now();
    const t = jwt(3600, now, { n: 1 });
    const fresh = jwt(7200, now, { n: 2 });
    let calls = 0;
    const refresh = async () => {
      calls++;
      return { token: fresh, record: rec() };
    };
    await Promise.all([verifySession(t, refresh), verifySession(t, refresh), verifySession(t, refresh)]);
    expect(calls).toBe(1);
    expect(cachedSession(t)).not.toBeNull();
    expect(cachedSession(fresh)).not.toBeNull();

    const bad = jwt(3600, now, { n: 3 });
    const refused = async () => {
      throw Object.assign(new Error('no'), { status: 401 });
    };
    await expect(verifySession(bad, refused)).rejects.toThrow('no');
    expect(cachedSession(bad)).toBeNull();
  });

  it('keeps no token in memory, only hashes', async () => {
    const t = jwt(3600);
    rememberSession(t, rec());
    const state = (globalThis as Record<symbol, { entries: Map<string, unknown> }>)[Symbol.for('ember.sessionCache')];
    const dump = JSON.stringify([...state.entries.keys()]);
    expect(dump).not.toContain(t.split('.')[1]);
    expect([...state.entries.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hands out a new token only once the old one is an hour old', () => {
    const now = Date.now();
    const fresh = jwt(14 * 86400, now);
    expect(shouldRotate(jwt(14 * 86400 - 60, now), fresh, now)).toBe(false);
    expect(shouldRotate(jwt(14 * 86400 - ROTATE_AFTER_MS / 1000 - 1, now), fresh, now)).toBe(true);
    expect(shouldRotate('opaque', fresh, now)).toBe(true);
  });
});
