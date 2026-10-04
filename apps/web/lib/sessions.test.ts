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

const { addMember } = await import('./sessions');

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
