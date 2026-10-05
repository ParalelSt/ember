// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type PocketBase from 'pocketbase';

// Joining a carlist: being on the roster already is fine, but a roster
// write that failed for any other reason must not be reported as a join.
// It was: the joiner got the session back, then a 403 "join it first" on
// every poll, with nothing in the log.

vi.mock('@/lib/auth', () => ({ ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: vi.fn() }));
vi.mock('@/lib/pocketbase/fileUrl', () => ({ fileUrl: vi.fn() }));

const { addMember, sessionExpired, endIfExpired, loadSession, LIVE_WINDOW_MS } = await import('./sessions');

const pbThatFails = (status: number) =>
  ({
    collection: () => ({
      create: async () => {
        throw Object.assign(new Error('pb said no'), { status });
      },
    }),
  }) as unknown as PocketBase;

describe('addMember', () => {
  it('already on the roster (unique index, 400) is not an error', async () => {
    await expect(addMember(pbThatFails(400), 's1', 'u1')).resolves.toBeUndefined();
  });

  it('a PocketBase failure is passed on, not swallowed', async () => {
    await expect(addMember(pbThatFails(500), 's1', 'u1')).rejects.toMatchObject({ status: 500 });
    await expect(addMember(pbThatFails(0), 's1', 'u1')).rejects.toMatchObject({ status: 0 });
  });
});

describe('carlist expiry', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const stamp = (agoMs: number) => new Date(now - agoMs).toISOString().replace('T', ' ');

  it('expires an active carlist idle past the live window, measured from updated', () => {
    expect(sessionExpired({ active: true, updated: stamp(LIVE_WINDOW_MS + 1000) } as never, now)).toBe(true);
    expect(sessionExpired({ active: true, updated: stamp(LIVE_WINDOW_MS - 60_000) } as never, now)).toBe(false);
  });

  it('does not expire a row without a parseable timestamp', () => {
    expect(sessionExpired({ active: true } as never, now)).toBe(false);
  });

  it('endIfExpired marks a stale carlist ended in the DB and returns it inactive', async () => {
    const update = vi.fn(async () => ({}));
    const pb = { collection: () => ({ update }) } as unknown as PocketBase;
    const row = { id: 's1', active: true, updated: stamp(LIVE_WINDOW_MS + 1000) } as never;
    const out = await endIfExpired(pb, row, now);
    expect(update).toHaveBeenCalledWith('s1', { active: false });
    expect(out.active).toBe(false);
  });

  it('endIfExpired leaves a fresh or already ended carlist alone', async () => {
    const update = vi.fn(async () => ({}));
    const pb = { collection: () => ({ update }) } as unknown as PocketBase;
    await endIfExpired(pb, { id: 's1', active: true, updated: stamp(1000) } as never, now);
    await endIfExpired(pb, { id: 's2', active: false, updated: stamp(LIVE_WINDOW_MS * 3) } as never, now);
    expect(update).not.toHaveBeenCalled();
  });

  it('loadSession returns an expired carlist as ended', async () => {
    const row = { id: 's1', active: true, updated: stamp(LIVE_WINDOW_MS + 1000) };
    const update = vi.fn(async () => ({}));
    const pb = { collection: () => ({ getOne: async () => ({ ...row }), update }) } as unknown as PocketBase;
    const s = await loadSession(pb, 's1');
    expect(s.active).toBe(false);
    expect(update).toHaveBeenCalledWith('s1', { active: false });
  });
});
