// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// requireUser / requireAdmin must take the member's id and admin flag from
// PocketBase, not from the pb_auth cookie (bughunt W01). The cookie's record
// is plain JSON the browser can edit; only the token is checked by PocketBase.

type Rec = { id: string; email: string; is_admin?: boolean };

const authRefresh = vi.fn<(token: string) => Promise<{ token: string; record: Rec }>>();
let cookie: { token: string; record: Rec | null; valid: boolean };

function fakeClient() {
  const store = {
    token: cookie.token,
    record: cookie.record as Rec | null,
    get isValid() {
      return cookie.valid && !!this.token;
    },
    save(token: string, record: Rec | null) {
      this.token = token;
      this.record = record;
    },
    clear() {
      this.token = '';
      this.record = null;
    },
  };
  return {
    authStore: store,
    collection: () => ({
      authRefresh: async () => {
        const res = await authRefresh(store.token);
        store.save(res.token, res.record);
        return res;
      },
    }),
  };
}

vi.mock('@/lib/pocketbase/server', () => ({ createClient: async () => fakeClient() }));

const { requireUser, requireAdmin, adminNow, UnauthorizedError, ForbiddenError } = await import('./auth');
const { _resetSessionCache, SESSION_CACHE_TTL_MS, forgetUser } = await import('./sessionCache');

const member: Rec = { id: 'alice', email: 'alice@ember.test', is_admin: false };
const admin: Rec = { id: 'boss', email: 'boss@ember.test', is_admin: true };
let seq = 0;
/** A JWT-shaped token, an hour from expiry (lib/sessionCache reads exp). */
const token = () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ id: 'x', n: ++seq, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};

beforeEach(() => {
  _resetSessionCache();
  authRefresh.mockReset();
  authRefresh.mockImplementation(async (t) => ({ token: `${t}-refreshed`, record: member }));
});
afterEach(() => vi.useRealTimers());

describe('requireUser / requireAdmin', () => {
  it('ignores an is_admin the cookie claims but the server does not', async () => {
    cookie = { token: token(), record: { ...member, is_admin: true }, valid: true };
    const { user } = await requireUser();
    expect(user.isAdmin).toBe(false);
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('takes the id from the server, not the cookie', async () => {
    cookie = { token: token(), record: { ...member, id: 'boss' }, valid: true };
    const { user } = await requireUser();
    expect(user.id).toBe('alice');
  });

  it('lets a real admin through', async () => {
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: admin }));
    cookie = { token: token(), record: admin, valid: true };
    const { user } = await requireAdmin();
    expect(user).toEqual({ id: 'boss', email: 'boss@ember.test', isAdmin: true });
  });

  it('refuses a token PocketBase rejects', async () => {
    authRefresh.mockRejectedValue(Object.assign(new Error('invalid'), { status: 401 }));
    cookie = { token: token(), record: { ...admin }, valid: true };
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses an expired or missing session without asking PocketBase', async () => {
    cookie = { token: token(), record: member, valid: false };
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    cookie = { token: '', record: null, valid: true };
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authRefresh).not.toHaveBeenCalled();
  });

  it('passes other failures (PocketBase down) through', async () => {
    authRefresh.mockRejectedValue(Object.assign(new Error('down'), { status: 0 }));
    cookie = { token: token(), record: member, valid: true };
    await expect(requireUser()).rejects.toThrow('down');
  });

  it('asks PocketBase once per token for the cache window, then again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    cookie = { token: token(), record: member, valid: true };
    await requireUser();
    const second = await requireUser();
    expect(authRefresh).toHaveBeenCalledTimes(1);
    // The cached answer still replaces whatever record the cookie carried.
    expect(second.pb.authStore.record).toEqual(member);
    // The route keeps the token it came with.
    expect(second.pb.authStore.token).toBe(cookie.token);
    vi.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1);
    await requireUser();
    expect(authRefresh).toHaveBeenCalledTimes(2);
  });

  it('never shares a cached answer between tokens', async () => {
    cookie = { token: token(), record: member, valid: true };
    await requireUser();
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: admin }));
    cookie = { token: token(), record: admin, valid: true };
    const { user } = await requireUser();
    expect(user.id).toBe('boss');
    expect(authRefresh).toHaveBeenCalledTimes(2);
  });

  it('admin routes always ask PocketBase: a demoted admin is refused at once', async () => {
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: admin }));
    cookie = { token: token(), record: admin, valid: true };
    await requireAdmin();
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: { ...admin, is_admin: false } }));
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    expect(authRefresh).toHaveBeenCalledTimes(2);
  });

  it('a revoked session stops working at once once its user is forgotten', async () => {
    cookie = { token: token(), record: member, valid: true };
    await requireUser();
    authRefresh.mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 }));
    // Still remembered: this is the documented window.
    await expect(requireUser()).resolves.toBeTruthy();
    forgetUser('alice');
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('a burst of calls with one new token asks PocketBase once', async () => {
    let release: () => void = () => {};
    authRefresh.mockImplementation((t) => new Promise((r) => { release = () => r({ token: `${t}-r`, record: member }); }));
    cookie = { token: token(), record: member, valid: true };
    const burst = Promise.all([requireUser(), requireUser(), requireUser()]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await burst;
    expect(authRefresh).toHaveBeenCalledTimes(1);
  });

  it('adminNow: a member is never an admin, and PocketBase is not asked', async () => {
    cookie = { token: token(), record: member, valid: true };
    const { user } = await requireUser();
    authRefresh.mockClear();
    expect(await adminNow(user)).toBe(false);
    expect(authRefresh).not.toHaveBeenCalled();
  });

  it('adminNow: an admin demoted moments ago (remembered as admin) is refused at once', async () => {
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: admin }));
    cookie = { token: token(), record: admin, valid: true };
    const { user } = await requireUser();
    expect(user.isAdmin).toBe(true);
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: { ...admin, is_admin: false } }));
    // requireUser still answers from memory: the documented window...
    expect((await requireUser()).user.isAdmin).toBe(true);
    // ...but an admin power asks PocketBase.
    expect(await adminNow(user)).toBe(false);
  });

  it('adminNow: a still-admin admin keeps the power; a dead session loses it', async () => {
    authRefresh.mockImplementation(async (t) => ({ token: `${t}-r`, record: admin }));
    cookie = { token: token(), record: admin, valid: true };
    const { user } = await requireUser();
    expect(await adminNow(user)).toBe(true);
    authRefresh.mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 }));
    expect(await adminNow(user)).toBe(false);
  });
});
