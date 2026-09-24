// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth';

/** The server's Discord card is one card, on the machine Ember runs on: the
 *  owner's. Only the owner's own session may set or clear it; any other
 *  member (sharing or not) and signed-out callers are ignored. Bughunt X3. */

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});
const discord = vi.hoisted(() => ({ updateDiscordActivity: vi.fn(), clearDiscordActivity: vi.fn() }));
vi.mock('@/lib/discord', () => discord);
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_name: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

function as(email: string, { share = true, admin = false } = {}) {
  requireUser.mockResolvedValue({
    pb: { collection: () => ({ getOne: async () => ({ share_discord: share }) }) },
    user: { id: `id-${email}`, email, isAdmin: admin },
  });
}

function push(isPlaying = true) {
  const body = { track: { title: 'Song', artist: 'X' }, isPlaying, positionSec: 10, durationSec: 200 };
  return POST(new NextRequest('http://127.0.0.1/api/discord/update', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
}

const envBefore = process.env.EMBER_ADMIN_EMAIL;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMBER_ADMIN_EMAIL = 'owner@ember.test';
});
afterEach(() => {
  if (envBefore === undefined) delete process.env.EMBER_ADMIN_EMAIL;
  else process.env.EMBER_ADMIN_EMAIL = envBefore;
});

describe('POST /api/discord/update', () => {
  it("sets the card for the owner's own session", async () => {
    as('Owner@Ember.test');
    const res = await push();
    expect(discord.updateDiscordActivity).toHaveBeenCalledTimes(1);
    expect(discord.clearDiscordActivity).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ ok: true, shared: true, owner: true });
  });

  it('clears the card when the owner stops or turns sharing off', async () => {
    as('owner@ember.test', { share: false });
    await push();
    expect(discord.clearDiscordActivity).toHaveBeenCalledTimes(1);
    expect(discord.updateDiscordActivity).not.toHaveBeenCalled();
  });

  it("ignores another member who shares (no take-over)", async () => {
    as('friend@ember.test', { share: true });
    const res = await push();
    expect(discord.updateDiscordActivity).not.toHaveBeenCalled();
    expect(discord.clearDiscordActivity).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ ok: true, owner: false });
  });

  it("ignores another member who doesn't share (no wipe)", async () => {
    as('friend@ember.test', { share: false });
    await push(false);
    expect(discord.clearDiscordActivity).not.toHaveBeenCalled();
    expect(discord.updateDiscordActivity).not.toHaveBeenCalled();
  });

  it('ignores a signed-out caller', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError());
    const res = await push();
    expect(res.status).toBe(401);
    expect(discord.clearDiscordActivity).not.toHaveBeenCalled();
    expect(discord.updateDiscordActivity).not.toHaveBeenCalled();
  });

  it('falls back to admins when no owner email is configured', async () => {
    delete process.env.EMBER_ADMIN_EMAIL;
    as('admin@ember.test', { admin: true });
    await push();
    expect(discord.updateDiscordActivity).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    as('friend@ember.test', { admin: false });
    await push();
    expect(discord.updateDiscordActivity).not.toHaveBeenCalled();
    expect(discord.clearDiscordActivity).not.toHaveBeenCalled();
  });
});
