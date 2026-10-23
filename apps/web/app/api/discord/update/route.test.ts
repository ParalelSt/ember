// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const envBefore = process.env.EMBER_ADMIN_EMAIL;
beforeEach(() => {
  update.mockReset();
  clear.mockReset();
  requireUserMock.mockReset();
  process.env.EMBER_ADMIN_EMAIL = 'owner@ember.test';
});
afterEach(() => {
  if (envBefore === undefined) delete process.env.EMBER_ADMIN_EMAIL;
  else process.env.EMBER_ADMIN_EMAIL = envBefore;
});

function as(email: string, { share = true, admin = false } = {}) {
  requireUserMock.mockResolvedValue({
    pb: { collection: () => ({ getOne: async () => ({ share_discord: share }) }) },
    user: { id: `id-${email}`, email, isAdmin: admin },
  });
}
const playing = { track: { id: 'youtube:abcdefghijk', title: 'Song' }, isPlaying: true };

describe('POST /api/discord/update', () => {
  it('a caller with no session cannot clear the host card', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(req({ track: null, isPlaying: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, shared: false });
    expect(clear).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // Bughunt X3: the card is one card, on the machine Ember runs on (the
  // owner's). Any other member who shares used to take it over, and one who
  // did not share wiped it on every pause.
  it("the owner's own session sets the card", async () => {
    as('Owner@Ember.test');
    const res = await POST(req(playing));
    expect(update).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ ok: true, shared: true, owner: true });
  });

  it('the owner clears it when sharing is off or the music stops', async () => {
    as('owner@ember.test', { share: false });
    await POST(req(playing));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('another member who shares cannot take the card over', async () => {
    as('friend@ember.test', { share: true });
    const res = await POST(req(playing));
    expect(update).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, shared: false, owner: false });
  });

  it("another member who doesn't share cannot wipe it", async () => {
    as('friend@ember.test', { share: false });
    await POST(req({ track: null, isPlaying: false }));
    expect(clear).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('with no owner email configured, admins own it', async () => {
    delete process.env.EMBER_ADMIN_EMAIL;
    as('admin@ember.test', { admin: true });
    await POST(req(playing));
    expect(update).toHaveBeenCalledTimes(1);
    update.mockReset();
    as('friend@ember.test');
    await POST(req(playing));
    expect(update).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});

// Two updates close together (a song change, then a pause) each wait on
// PocketBase before they touch the card. The older one answering last put
// back "playing" over the pause, and the card stayed wrong until the next
// change.
describe('POST /api/discord/update, two at once', () => {
  it('an older update that finishes last does not undo a newer one', async () => {
    const lookups: Array<() => void> = [];
    requireUserMock.mockImplementation(async () => {
      await new Promise<void>((r) => lookups.push(r));
      return {
        pb: { collection: () => ({ getOne: async () => ({ share_discord: true }) }) },
        user: { id: 'owner', email: 'owner@ember.test', isAdmin: true },
      };
    });

    const first = POST(req(playing));
    const second = POST(req({ track: playing.track, isPlaying: false }));
    await vi.waitFor(() => expect(lookups).toHaveLength(2));
    lookups[1]();
    await second;
    expect(clear).toHaveBeenCalledTimes(1);
    lookups[0]();
    await first;

    expect(update).not.toHaveBeenCalled();
  });

  it("another member's call in between does not hold the owner's update back", async () => {
    const lookups: Array<() => void> = [];
    const owner = { id: 'owner', email: 'owner@ember.test', isAdmin: true };
    const friend = { id: 'friend', email: 'friend@ember.test', isAdmin: false };
    const who = [owner, friend];
    requireUserMock.mockImplementation(async () => {
      const user = who.shift()!;
      await new Promise<void>((r) => lookups.push(r));
      return { pb: { collection: () => ({ getOne: async () => ({ share_discord: true }) }) }, user };
    });

    const mine = POST(req(playing));
    const theirs = POST(req({ track: null, isPlaying: false }));
    await vi.waitFor(() => expect(lookups).toHaveLength(2));
    lookups[1]();
    await theirs;
    lookups[0]();
    await mine;

    expect(update).toHaveBeenCalledTimes(1);
  });
});
