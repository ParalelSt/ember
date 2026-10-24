// @vitest-environment node
/** The reused admin login (createCatalogClient). PocketBase reads a request
 *  whose admin token has died (a restore, or the admin password changed,
 *  both give the superuser a new token key) as a GUEST: no 401, just a 404
 *  or an empty list. So the shared client asks PocketBase whether its token
 *  still holds whenever an answer looks like "nothing", signs in again once
 *  if not, and repeats the request. A real PocketBase 0.22 is played here
 *  by a fake fetch. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));

process.env.POCKETBASE_ADMIN_EMAIL = 'admin@example.test';
process.env.POCKETBASE_ADMIN_PASSWORD = 'secret';

interface FakePb {
  /** The admin token PocketBase accepts right now. */
  live: string;
  logins: number;
  refreshes: number;
  playlists: Record<string, unknown>[];
}
let pb: FakePb;
/** Row ids whose answer is held back a moment (once each). */
const slow = new Set<string>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const auth = new Headers(init?.headers).get('Authorization') ?? '';
  const admin = auth === pb.live;
  const path = url.pathname;
  if (path === '/api/collections/_superusers/auth-with-password' || path === '/api/collections/_superusers/auth-refresh') {
    return Promise.resolve(json(404, { message: 'Missing collection context.' }));
  }
  if (path === '/api/admins/auth-with-password') {
    pb.logins += 1;
    pb.live = `token-${pb.logins}`;
    return Promise.resolve(json(200, { token: pb.live, admin: { id: 'a1' } }));
  }
  if (path === '/api/admins/auth-refresh') {
    pb.refreshes += 1;
    return Promise.resolve(admin ? json(200, { token: auth, admin: { id: 'a1' } }) : json(401, { message: 'invalid token' }));
  }
  // A guest sees nothing of an owner-only collection: 404 for one row, an
  // empty page for a list. Exactly what a dead admin token gets.
  const rows = admin ? pb.playlists : [];
  const one = /^\/api\/collections\/playlists\/records\/(\w+)$/.exec(path);
  if (one) {
    const row = rows.find((r) => r.id === one[1]);
    const answer = row ? json(200, row) : json(404, { message: "The requested resource wasn't found." });
    // Decided now, with the token the request carried; delivered later.
    if (slow.delete(one[1])) return new Promise((resolve) => setTimeout(() => resolve(answer), 30));
    return Promise.resolve(answer);
  }
  if (path === '/api/collections/playlists/records') {
    return Promise.resolve(json(200, { page: 1, perPage: 1000, totalItems: -1, totalPages: -1, items: rows }));
  }
  return Promise.resolve(json(404, { message: 'no route' }));
}

async function fresh() {
  vi.resetModules();
  return import('./server');
}

/** Past the few seconds a confirmed token is trusted without asking. */
const later = () => vi.setSystemTime(Date.now() + 6_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  pb = { live: '', logins: 0, refreshes: 0, playlists: [{ id: 'p1', name: 'Road trip' }] };
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createCatalogClient', () => {
  it('signs in once and asks nothing extra while answers come back', async () => {
    const { createCatalogClient } = await fresh();
    for (let i = 0; i < 10; i++) {
      const client = await createCatalogClient();
      expect(await client.collection('playlists').getOne('p1')).toMatchObject({ name: 'Road trip' });
    }
    expect(pb.logins).toBe(1);
    expect(pb.refreshes).toBe(0);
  });

  it('a token that died (a restore) signs in again once and answers, instead of "not found"', async () => {
    const { createCatalogClient } = await fresh();
    await (await createCatalogClient()).collection('playlists').getOne('p1');
    pb.live = 'after-restore'; // the old token now reads as a guest
    later();

    const row = await (await createCatalogClient()).collection('playlists').getOne('p1');

    expect(row).toMatchObject({ name: 'Road trip' });
    expect(pb.logins).toBe(2);
    // And the new login is the one reused from then on.
    await (await createCatalogClient()).collection('playlists').getOne('p1');
    expect(pb.logins).toBe(2);
  });

  it('the same for a list that a dead token reads as empty', async () => {
    const { createCatalogClient } = await fresh();
    await (await createCatalogClient()).collection('playlists').getFullList();
    pb.live = 'after-password-change';
    later();

    const rows = await (await createCatalogClient()).collection('playlists').getFullList();

    expect(rows).toHaveLength(1);
    expect(pb.logins).toBe(2);
  });

  it('a real "not found" on a live token stays not found, with no new sign-in, and is checked at most every few seconds', async () => {
    const { createCatalogClient } = await fresh();
    const client = await createCatalogClient();
    later();
    await expect(client.collection('playlists').getOne('gone')).rejects.toMatchObject({ status: 404 });
    await expect(client.collection('playlists').getOne('gone2')).rejects.toMatchObject({ status: 404 });
    expect(pb.logins).toBe(1);
    expect(pb.refreshes).toBe(1);
  });

  it('several requests finding the token dead at once sign in only once', async () => {
    const { createCatalogClient } = await fresh();
    await (await createCatalogClient()).collection('playlists').getOne('p1');
    pb.live = 'after-restore';
    later();

    const clients = await Promise.all(Array.from({ length: 5 }, () => createCatalogClient()));
    const rows = await Promise.all(clients.map((c) => c.collection('playlists').getOne('p1', { requestKey: null })));

    expect(rows.every((r) => r.name === 'Road trip')).toBe(true);
    expect(pb.logins).toBe(2);
  });

  it('two requests on one client: the slower one, sent with the dead token, is healed too', async () => {
    const { createCatalogClient } = await fresh();
    await (await createCatalogClient()).collection('playlists').getOne('p1');
    pb.playlists.push({ id: 'p2', name: 'Night drive' });
    pb.live = 'after-restore';
    later();
    // p2's guest answer arrives only after the p1 request has signed in
    // again and put the new token on the shared client.
    slow.add('p2');

    const client = await createCatalogClient();
    const rows = await Promise.all([
      client.collection('playlists').getOne('p1', { requestKey: null }),
      client.collection('playlists').getOne('p2', { requestKey: null }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(['Road trip', 'Night drive']);
    expect(pb.logins).toBe(2);
  });
});
