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

const getList = vi.fn(async () => ({
  items: [
    play({ name: '', email: 'jane.secret@example.com', share_listening: true }, 'u2'),
    play({ name: 'Bob', email: 'bob@example.com', share_listening: true }, 'u3'),
  ],
}));

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: {}, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ getList }) }),
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
});
