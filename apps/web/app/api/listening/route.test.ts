// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// "Listening now" shows other members by name. A member with no name must
// not be shown by the start of their email address: names elsewhere fall
// back to "Unnamed member" (lib/collab publicName), never to the email.

const play = (user: Record<string, unknown>, id: string) => ({
  user: id,
  played_at: '2026-10-04 10:00:00.000Z',
  expand: {
    user,
    track: { id: 't1', external_id: 'youtube:abcdefghijk', source: 'youtube', source_id: 'abcdefghijk', title: 'Song' },
  },
});

let plays = [
  play({ name: '', email: 'jane.secret@example.com', share_listening: true }, 'u2'),
  play({ name: 'Bob', email: 'bob@example.com', share_listening: true }, 'u3'),
];
const getList = vi.fn(async (page: number, perPage: number) => ({
  items: plays.slice((page - 1) * perPage, page * perPage),
  page,
  perPage,
  totalItems: plays.length,
  totalPages: Math.ceil(plays.length / perPage),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: {}, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
// createAdminClient signs in with the admin password on every call; the
// catalog client reuses one login.
const logins = vi.hoisted(() => ({ fresh: 0 }));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => {
    logins.fresh += 1;
    return { collection: () => ({ getList }) };
  },
  createCatalogClient: async () => ({ collection: () => ({ getList }) }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');

describe('GET /api/listening', () => {
  it('never shows a member by their email address', async () => {
    const res = await (GET as unknown as () => Promise<Response>)();
    const body = (await res.json()) as { items: { userName: string }[] };
    expect(JSON.stringify(body)).not.toContain('jane.secret');
    expect(body.items.map((i) => i.userName)).toEqual(['Unnamed member', 'Bob']);
  });

  it('does not sign in as admin on every poll (Home asks every 30 s)', async () => {
    logins.fresh = 0;
    for (let i = 0; i < 5; i += 1) await (GET as unknown as () => Promise<Response>)();
    expect(logins.fresh).toBe(0);
  });

  it('one member skimming through songs does not hide everyone else', async () => {
    // Every song start is a play. The newest 100 plays of the last half
    // hour were all that was read, so someone skipping through songs (or a
    // run of unplayable ones skipping themselves) filled them, and nobody
    // else was "listening".
    const before = plays;
    const skimmer = { name: 'Quiet', share_listening: false };
    plays = [...Array.from({ length: 250 }, () => play(skimmer, 'u4')), play({ name: 'Bob', share_listening: true }, 'u3')];
    try {
      const res = await (GET as unknown as () => Promise<Response>)();
      const body = (await res.json()) as { items: { userName: string }[] };
      expect(body.items.map((i) => i.userName)).toEqual(['Bob']);
    } finally {
      plays = before;
    }
  });
});
