// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// /api/discord/ is public (proxy.ts), and this route drives the HOST's
// Discord card. A caller with no session has no say in it: it must not be
// able to wipe what a signed-in member is showing.

const update = vi.fn();
const clear = vi.fn();
vi.mock('@/lib/discord', () => ({
  updateDiscordActivity: (...a: unknown[]) => update(...a),
  clearDiscordActivity: () => clear(),
}));
const requireUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = (await import('./route')) as unknown as { POST: (r: NextRequest) => Promise<Response> };
const req = (body: unknown) =>
  new NextRequest('http://ember.test/api/discord/update', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  update.mockReset();
  clear.mockReset();
  requireUserMock.mockReset();
});

describe('POST /api/discord/update', () => {
  it('a caller with no session cannot clear the host card', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(req({ track: null, isPlaying: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, shared: false });
    expect(clear).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a member who shares sets the card', async () => {
    requireUserMock.mockResolvedValue({
      pb: { collection: () => ({ getOne: async () => ({ share_discord: true }) }) },
      user: { id: 'u1' },
    });
    const res = await POST(req({ track: { id: 'youtube:abcdefghijk', title: 'Song' }, isPlaying: true }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
