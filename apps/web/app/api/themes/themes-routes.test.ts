// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import type { ThemeInputs } from '@/lib/theme/model';

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
const listRoute = await import('@/app/api/themes/route');
const oneRoute = await import('@/app/api/themes/[id]/route');

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;
const FOREST = PRESET_BY_ID.forest.inputs;
/** Accent almost the background: links and buttons unreadable. */
const UNREADABLE: ThemeInputs = { ...MIDNIGHT, accent: [0.24, 0.05, 262], accentHover: [0.3, 0.05, 262] };

const ME = 'me0000000000001';
const LUKA = 'luka00000000001';
const IVA = 'iva000000000001';

function as(userId: string) {
  requireUserMock.mockResolvedValue({ user: { id: userId }, pb: fake.pb });
}
function req(body?: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const users = () => fake.rows.get('users')!;
const userRow = (id: string) => users().find((u) => u.id === id)!;
const themes = () => fake.rows.get('themes') ?? [];

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
    created: `2026-09-23 10:00:${String(seq).padStart(2, '0')}`,
    updated: `2026-09-23 10:00:${String(seq).padStart(2, '0')}`,
    collectionId: 'themes',
    collectionName: 'themes',
  });
  return id;
}

beforeEach(() => {
  seq = 0;
  fake = fakePocketBase({
    users: [
      { id: ME, name: 'Aron' },
      { id: LUKA, name: 'Luka' },
      { id: IVA, name: '' },
    ],
    themes: [],
  });
  requireUserMock.mockReset();
  as(ME);
});

describe('GET/PATCH /api/theme', () => {
  it('is Ember until something is saved', async () => {
    const res = await themeRoute.GET(req(), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 1, preset: 'ember' });
  });

  it('401 without a user', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError());
    expect((await themeRoute.GET(req(), undefined as never)).status).toBe(401);
    expect((await themeRoute.PATCH(req({ preset: 'mono' }), undefined as never)).status).toBe(401);
  });

  it('picks a preset and stores it on the user row', async () => {
    const res = await themeRoute.PATCH(req({ preset: 'midnight' }), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 1, preset: 'midnight' });
    expect(userRow(ME).theme).toEqual({ v: 1, preset: 'midnight' });
    expect(await (await themeRoute.GET(req(), undefined as never)).json()).toEqual({ v: 1, preset: 'midnight' });
  });

  it('picks one of my themes or a shared one, colours copied in', async () => {
    const mine = seedTheme(ME, 'Night drive', MIDNIGHT);
    const shared = seedTheme(LUKA, 'Cold brew', FOREST, true, 'forest');
    expect(await (await themeRoute.PATCH(req({ themeId: mine }), undefined as never)).json()).toEqual({
      v: 1, preset: 'midnight', custom: MIDNIGHT, name: 'Night drive', themeId: mine,
    });
    expect(await (await themeRoute.PATCH(req({ themeId: shared }), undefined as never)).json()).toEqual({
      v: 1, preset: 'forest', custom: FOREST, name: 'Cold brew', themeId: shared,
    });
    expect(userRow(ME).theme).toMatchObject({ themeId: shared });
  });

  it("refuses someone else's private theme, junk bodies, and an unreadable row", async () => {
    const hidden = seedTheme(LUKA, 'Secret', FOREST, false);
    expect((await themeRoute.PATCH(req({ themeId: hidden }), undefined as never)).status).toBe(404);
    expect((await themeRoute.PATCH(req({ themeId: 'nothere00000000' }), undefined as never)).status).toBe(404);
    for (const body of [null, {}, { preset: 'sunset' }, { preset: 'mono', themeId: hidden }, { custom: MIDNIGHT }]) {
      expect((await themeRoute.PATCH(req(body), undefined as never)).status).toBe(400);
    }
    const bad = seedTheme(ME, 'Bad', UNREADABLE);
    const res = await themeRoute.PATCH(req({ themeId: bad }), undefined as never);
    expect(res.status).toBe(422);
    expect(userRow(ME).theme).toBeUndefined();
  });

  it("follows the creator's edits to a shared theme on the next load", async () => {
    const shared = seedTheme(LUKA, 'Cold brew', FOREST, true, 'forest');
    await themeRoute.PATCH(req({ themeId: shared }), undefined as never);
    as(LUKA);
    await oneRoute.PATCH(req({ inputs: MIDNIGHT, name: 'Colder brew' }), ctx(shared));
    as(ME);
    const doc = await (await themeRoute.GET(req(), undefined as never)).json();
    expect(doc).toEqual({ v: 1, preset: 'forest', custom: MIDNIGHT, name: 'Colder brew', themeId: shared });
    expect(userRow(ME).theme).toEqual(doc);
  });

  it('keeps a copy of the colours when the theme in use is unshared or deleted', async () => {
    const a = seedTheme(LUKA, 'Cold brew', FOREST, true, 'forest');
    const b = seedTheme(LUKA, 'Campfire', MIDNIGHT, true);
    await themeRoute.PATCH(req({ themeId: a }), undefined as never);
    as(IVA);
    await themeRoute.PATCH(req({ themeId: b }), undefined as never);

    as(LUKA);
    expect((await oneRoute.PATCH(req({ shared: false }), ctx(a))).status).toBe(200);
    expect((await oneRoute.DELETE(req(), ctx(b))).status).toBe(200);

    as(ME);
    expect(await (await themeRoute.GET(req(), undefined as never)).json()).toEqual({
      v: 1, preset: 'forest', custom: FOREST, name: 'Cold brew',
    });
    as(IVA);
    expect(await (await themeRoute.GET(req(), undefined as never)).json()).toEqual({
      v: 1, preset: 'midnight', custom: MIDNIGHT, name: 'Campfire',
    });
    expect(userRow(IVA).theme).not.toHaveProperty('themeId');
  });
});

describe('GET/POST /api/themes', () => {
  it("lists mine, and everyone else's shared themes with the creator's name", async () => {
    const mine = seedTheme(ME, 'Night drive', MIDNIGHT, true);
    const lukas = seedTheme(LUKA, 'Cold brew', FOREST, true, 'forest');
    seedTheme(LUKA, 'Secret', FOREST, false);
    const ivas = seedTheme(IVA, 'Campfire', MIDNIGHT, true);
    const body = await (await listRoute.GET(req(), undefined as never)).json();
    expect(body.cap).toBe(20);
    expect(body.mine.map((t: { id: string }) => t.id)).toEqual([mine]);
    expect(body.mine[0]).toMatchObject({ name: 'Night drive', base: 'midnight', inputs: MIDNIGHT, shared: true });
    expect(body.shared.map((t: { id: string; ownerName: string }) => [t.id, t.ownerName])).toEqual([
      [ivas, 'Someone'],
      [lukas, 'Luka'],
    ]);
    expect(JSON.stringify(body.shared)).not.toMatch(/owner"|email/);
  });

  it('creates a theme, unshared unless asked', async () => {
    const res = await listRoute.POST(req({ name: '  Late  shift ', base: 'forest', inputs: FOREST }), undefined as never);
    expect(res.status).toBe(201);
    const { theme } = await res.json();
    expect(theme).toMatchObject({ name: 'Late shift', base: 'forest', inputs: FOREST, shared: false });
    expect(themes()[0]).toMatchObject({ owner: ME, name: 'Late shift', shared: false });
    const shared = await (await listRoute.POST(req({ name: 'Open', base: 'mono', inputs: MIDNIGHT, shared: true }), undefined as never)).json();
    expect(shared.theme.shared).toBe(true);
  });

  it('names the bad field', async () => {
    const cases: [unknown, string][] = [
      [{ base: 'forest', inputs: FOREST }, 'name: 1 to 40 characters'],
      [{ name: 'x'.repeat(41), base: 'forest', inputs: FOREST }, 'name: 1 to 40 characters'],
      [{ name: 'A', base: 'sunset', inputs: FOREST }, 'base: unknown preset'],
      [{ name: 'A', base: 'forest', inputs: { ...FOREST, accent: [2, 0.1, 20] } }, 'accent: lightness out of range'],
      [{ name: 'A', base: 'forest', inputs: FOREST, shared: 'yes' }, 'shared: expected true or false'],
      [[1, 2], 'Expected a JSON object'],
    ];
    for (const [body, error] of cases) {
      const res = await listRoute.POST(req(body), undefined as never);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(themes()).toHaveLength(0);
  });

  it('refuses an unreadable theme with the failing pairs, never adjusting it', async () => {
    const res = await listRoute.POST(req({ name: 'Murky', base: 'midnight', inputs: UNREADABLE }), undefined as never);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Fix the readability problems to save');
    expect(body.findings.map((f: { pair: string }) => f.pair)).toContain('accent');
    expect(themes()).toHaveLength(0);
  });

  it('stops at 20 themes per person', async () => {
    for (let i = 0; i < 19; i++) seedTheme(ME, `T${i}`, MIDNIGHT);
    seedTheme(LUKA, 'Not mine', MIDNIGHT);
    expect((await listRoute.POST(req({ name: 'Twentieth', base: 'mono', inputs: MIDNIGHT }), undefined as never)).status).toBe(201);
    const res = await listRoute.POST(req({ name: 'One too many', base: 'mono', inputs: MIDNIGHT }), undefined as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/up to 20 themes/);
    const dup = await listRoute.POST(req({ duplicateOf: themes()[0]!.id }), undefined as never);
    expect(dup.status).toBe(409);
    expect(themes().filter((t) => t.owner === ME)).toHaveLength(20);
  });

  it('duplicates mine or a shared one into an unshared copy of mine', async () => {
    const lukas = seedTheme(LUKA, 'Cold brew', FOREST, true, 'forest');
    const res = await listRoute.POST(req({ duplicateOf: lukas }), undefined as never);
    expect(res.status).toBe(201);
    const { theme } = await res.json();
    expect(theme).toMatchObject({ name: 'Cold brew copy', base: 'forest', inputs: FOREST, shared: false });
    expect(themes().find((t) => t.id === theme.id)).toMatchObject({ owner: ME });
    const named = await (await listRoute.POST(req({ duplicateOf: theme.id, name: 'Mine now' }), undefined as never)).json();
    expect(named.theme.name).toBe('Mine now');
    const hidden = seedTheme(LUKA, 'Secret', FOREST, false);
    expect((await listRoute.POST(req({ duplicateOf: hidden }), undefined as never)).status).toBe(404);
    expect((await listRoute.POST(req({ duplicateOf: 'x' }), undefined as never)).status).toBe(400);
  });
});

describe('PATCH/DELETE /api/themes/[id]', () => {
  it('renames, edits colours and toggles sharing on my own theme', async () => {
    const id = seedTheme(ME, 'Night drive', MIDNIGHT);
    const renamed = await (await oneRoute.PATCH(req({ name: 'Night ride' }), ctx(id))).json();
    expect(renamed.theme).toMatchObject({ id, name: 'Night ride', shared: false });
    expect(renamed).not.toHaveProperty('active');
    await oneRoute.PATCH(req({ inputs: FOREST, base: 'forest' }), ctx(id));
    await oneRoute.PATCH(req({ shared: true }), ctx(id));
    expect(themes()[0]).toMatchObject({ name: 'Night ride', inputs: FOREST, base: 'forest', shared: true });
    as(LUKA);
    const seen = await (await listRoute.GET(req(), undefined as never)).json();
    expect(seen.shared.map((t: { id: string }) => t.id)).toEqual([id]);
    as(ME);
    await oneRoute.PATCH(req({ shared: false }), ctx(id));
    as(LUKA);
    expect((await (await listRoute.GET(req(), undefined as never)).json()).shared).toEqual([]);
  });

  it("only lets the creator change or delete it", async () => {
    const shared = seedTheme(LUKA, 'Cold brew', FOREST, true);
    const hidden = seedTheme(LUKA, 'Secret', FOREST, false);
    expect((await oneRoute.PATCH(req({ name: 'Mine' }), ctx(shared))).status).toBe(403);
    expect((await oneRoute.DELETE(req(), ctx(shared))).status).toBe(403);
    expect((await oneRoute.PATCH(req({ name: 'Mine' }), ctx(hidden))).status).toBe(404);
    expect((await oneRoute.DELETE(req(), ctx(hidden))).status).toBe(404);
    expect((await oneRoute.DELETE(req(), ctx('../users'))).status).toBe(404);
    expect(themes().map((t) => t.name)).toEqual(['Cold brew', 'Secret']);
  });

  it('refuses a bad patch and an unreadable edit, leaving the theme alone', async () => {
    const id = seedTheme(ME, 'Night drive', MIDNIGHT);
    expect((await oneRoute.PATCH(req({}), ctx(id))).status).toBe(400);
    expect((await oneRoute.PATCH(req({ name: '' }), ctx(id))).status).toBe(400);
    expect((await oneRoute.PATCH(req({ shared: 1 }), ctx(id))).status).toBe(400);
    expect((await oneRoute.PATCH(req({ inputs: UNREADABLE }), ctx(id))).status).toBe(422);
    expect(themes()[0]).toMatchObject({ name: 'Night drive', inputs: MIDNIGHT, shared: false });
  });

  it('keeps my active copy in step with edits, and falls back to its base preset when I delete it [bughunt V10]', async () => {
    const id = seedTheme(ME, 'Night drive', MIDNIGHT);
    await themeRoute.PATCH(req({ themeId: id }), undefined as never);
    const edited = await (await oneRoute.PATCH(req({ inputs: FOREST }), ctx(id))).json();
    expect(edited.active).toEqual({ v: 1, preset: 'midnight', custom: FOREST, name: 'Night drive', themeId: id });
    expect(userRow(ME).theme).toEqual(edited.active);

    // Deleting my own theme is a choice to stop using it: no kept copy
    // (that is for someone else's theme vanishing under me).
    const deleted = await (await oneRoute.DELETE(req(), ctx(id))).json();
    expect(deleted).toEqual({ ok: true, active: { v: 1, preset: 'midnight' } });
    expect(themes()).toHaveLength(0);
    expect(userRow(ME).theme).toEqual(deleted.active);
    expect(await (await themeRoute.GET(req(), undefined as never)).json()).toEqual({ v: 1, preset: 'midnight' });
  });

  it('leaves my active theme alone when I delete one I am not using [bughunt V10]', async () => {
    const using = seedTheme(ME, 'Night drive', MIDNIGHT);
    const other = seedTheme(ME, 'Cold brew', FOREST, false, 'forest');
    await themeRoute.PATCH(req({ themeId: using }), undefined as never);
    const deleted = await (await oneRoute.DELETE(req(), ctx(other))).json();
    expect(deleted).toEqual({ ok: true });
    expect(userRow(ME).theme).toMatchObject({ themeId: using, name: 'Night drive' });
  });

  it('others using my shared theme still keep their copy when I delete it [bughunt V10]', async () => {
    const id = seedTheme(ME, 'Night drive', FOREST, true);
    await themeRoute.PATCH(req({ themeId: id }), undefined as never);
    as(IVA);
    await themeRoute.PATCH(req({ themeId: id }), undefined as never);
    as(ME);
    expect(await (await oneRoute.DELETE(req(), ctx(id))).json()).toEqual({ ok: true, active: { v: 1, preset: 'midnight' } });
    as(IVA);
    expect(await (await themeRoute.GET(req(), undefined as never)).json()).toEqual({
      v: 1, preset: 'midnight', custom: FOREST, name: 'Night drive',
    });
  });
});
