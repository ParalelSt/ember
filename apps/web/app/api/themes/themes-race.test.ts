// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import type { ThemeInputs } from '@/lib/theme/model';

// bughunt N2: switching theme right after an edit could undo the switch on
// the server. leave()->flush() sends PATCH /api/themes/A (save the edit)
// at the same moment select() sends PATCH /api/theme {themeId: B} (the
// switch). This simulates that interleaving directly against the routes,
// with no client involved, so it proves the server side of the fix on its
// own (the client fix, tested separately, removes the interleaving for the
// normal UI path; this test covers any other caller that can still race).

class UnauthorizedError extends Error {}
const requireUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
let fake: FakePb;
vi.mock('@/lib/theme/themesRepo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/theme/themesRepo')>();
  return { ...real, openThemesRepo: async () => real.repoFor(fake.pb) };
});

const themeRoute = await import('@/app/api/theme/route');
const oneRoute = await import('@/app/api/themes/[id]/route');

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;
const FOREST = PRESET_BY_ID.forest.inputs;
const NEBULA = PRESET_BY_ID.nebula.inputs;

const ME = 'me0000000000001';

function as(userId: string) {
  requireUserMock.mockResolvedValue({ user: { id: userId }, pb: fake.pb });
}
function req(body?: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const userRow = (id: string) => fake.rows.get('users')!.find((u) => u.id === id)!;

let seq = 0;
function seedTheme(owner: string, name: string, inputs: ThemeInputs, shared = false, base = 'midnight') {
  seq += 1;
  const id = `theme${String(seq).padStart(10, '0')}`;
  fake.rows.get('themes')!.push({
    id,
    owner,
    name,
    base,
    inputs,
    shared,
    created: `2026-09-24 10:00:${String(seq).padStart(2, '0')}`,
    updated: `2026-09-24 10:00:${String(seq).padStart(2, '0')}`,
    collectionId: 'themes',
    collectionName: 'themes',
  });
  return id;
}

beforeEach(() => {
  seq = 0;
  fake = fakePocketBase({ users: [{ id: ME, name: 'Aron' }], themes: [] });
  requireUserMock.mockReset();
  as(ME);
});

/** Delays the very next `users` collection write, resolving once released:
 *  lands a switch squarely in the gap between an edit-save's read of the
 *  active theme and its write of it back. */
function delayNextUsersWrite(): { released: Promise<void>; release: () => void } {
  const originalCollection = fake.pb.collection.bind(fake.pb);
  let armed = true;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(fake.pb, 'collection').mockImplementation((name: string) => {
    const handle = originalCollection(name);
    if (name !== 'users') return handle;
    const originalUpdate = handle.update.bind(handle);
    return {
      ...handle,
      update: async (id: string, patch: Record<string, unknown>) => {
        if (armed) {
          armed = false;
          await released;
        }
        return originalUpdate(id, patch);
      },
    } as unknown as ReturnType<typeof originalCollection>;
  });
  return { released, release };
}

describe('edit-save vs switch: no lost update (bughunt N2)', () => {
  it('a switch fired right after an edit-save is not undone by the save landing late', async () => {
    const a = seedTheme(ME, 'Night drive', MIDNIGHT);
    const b = seedTheme(ME, 'Cold brew', FOREST, false, 'forest');
    await themeRoute.PATCH(req({ themeId: a }), undefined as never);
    expect(userRow(ME).theme).toMatchObject({ themeId: a });

    // Hold the edit-save's write to users.theme open: exactly the window
    // bughunt N2 exploited (its read of the active theme, still `a`, has
    // already happened by the time an update call is made).
    const { release } = delayNextUsersWrite();

    // Fire both requests as the client does: the edit-save first, then the
    // switch, neither awaited before the other starts.
    const editDone = oneRoute.PATCH(req({ inputs: NEBULA }), ctx(a));
    const switchDone = themeRoute.PATCH(req({ themeId: b }), undefined as never);

    // Give the switch every chance to run to completion while the
    // edit-save sits paused at its write — on the unfixed route this is
    // enough for it to land in full before the edit-save resumes.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    release();
    const [editRes, switchRes] = await Promise.all([editDone, switchDone]);
    expect(editRes.status).toBe(200);
    expect(switchRes.status).toBe(200);

    // The switch to b must be what sticks: the edit-save's write was for
    // theme a, no longer the active theme by the time it lands.
    expect(userRow(ME).theme).toMatchObject({ themeId: b });
  });
});
