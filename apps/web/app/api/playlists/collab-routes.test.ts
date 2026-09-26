// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createWorld, type World } from '@/test-utils/fakePlaylistPb';
import type { Track } from '@/types/track';

// Collaborative playlists, route by route, for the four people who matter:
// the owner, a member, someone on the server who is not a member, and an
// Ember admin who is not a member either (an admin gets nothing extra).
// test-utils/fakePlaylistPb follows the real PocketBase rules, so a route
// that tried a member's write with the member's own session would fail here
// as it would on the server.

let world: World;
const caller = { id: '', isAdmin: false };

class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({
    pb: world.member(caller.id),
    user: { id: caller.id, email: `${caller.id}@ember.test`, isAdmin: caller.isAdmin },
  }),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
/** Set to hand the routes a broken server client for one test. */
let serverOverride: unknown = null;
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: async () => serverOverride ?? world.server() }));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: async (t: Track) => {
    const hit = world.db.tracks.find((r) => r.external_id === t.id);
    return hit ? hit.id : world.addTrack(t.id, t.title).id;
  },
  jsonError: (error: string, status = 500) => Response.json({ error }, { status }),
  fromError: (e: { message?: string; status?: number }) =>
    Response.json({ error: e?.message ?? 'error' }, { status: e?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const list = await import('./route');
const one = await import('./[id]/route');
const tracksRoute = await import('./[id]/tracks/route');
const removeRoute = await import('./[id]/tracks/[trackId]/route');
const moveRoute = await import('./[id]/tracks/move/route');
const artworkRoute = await import('./[id]/artwork/route');
const collabRoute = await import('./[id]/collab/route');
const inviteRoute = await import('./[id]/invite/route');
const membersRoute = await import('./[id]/members/route');
const memberRoute = await import('./[id]/members/[userId]/route');
const peopleRoute = await import('./[id]/people/route');
const joinRoute = await import('./join/route');

type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const req = (body?: unknown) =>
  ({ json: async () => body, formData: async () => new FormData(), headers: new Headers() }) as unknown as NextRequest;
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
async function call(handler: unknown, as: string, params: Record<string, string> = {}, body?: unknown) {
  caller.id = as;
  caller.isAdmin = as === admin;
  const res = await (handler as Handler)(req(body), ctx(params));
  return { status: res.status, body: await res.json() };
}

const song = (id: string): Track => ({
  id,
  source: 'youtube',
  sourceId: id.split(':')[1],
  title: id,
  artist: 'Band',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});

let owner: string, member: string, outsider: string, admin: string;
let shared: string, secret: string;
const order = (pid: string) =>
  world.db.playlist_tracks
    .filter((r) => r.playlist === pid)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((r) => world.db.tracks.find((t) => t.id === r.track)?.external_id);

beforeEach(() => {
  serverOverride = null;
  world = createWorld();
  owner = world.addUser('Olga').id;
  member = world.addUser('Mia', { avatar: 'mia.png' }).id;
  outsider = world.addUser('Xan').id;
  admin = world.addUser('Ada', { is_admin: true }).id;
  shared = world.addPlaylist(owner, 'Road trip', { collaborative: true, invite_code: 'A'.repeat(32), import_job: 'job1' }).id;
  secret = world.addPlaylist(owner, 'Diary').id;
  const [a, b, c] = ['youtube:aaa', 'youtube:bbb', 'youtube:ccc'].map((id) => world.addTrack(id).id);
  world.addRow(shared, a, 1, owner);
  world.addRow(shared, b, 2, member);
  world.addRow(shared, c, 3, owner);
  world.addRow(secret, a, 1);
  world.addMember(shared, member);
});

describe('reading a playlist', () => {
  it('the owner and a member read it, with who added each song; nobody else does', async () => {
    const o = await call(one.GET, owner, { id: shared });
    expect(o.status).toBe(200);
    expect(o.body.playlist).toMatchObject({ role: 'owner', collaborative: true, import_job: 'job1', owner_name: null });
    expect(o.body.tracks.map((t: { addedBy: { name: string } }) => t.addedBy.name)).toEqual(['Olga', 'Mia', 'Olga']);

    const m = await call(one.GET, member, { id: shared });
    expect(m.status).toBe(200);
    // The import job is the owner's; the member never gets its id.
    expect(m.body.playlist).toMatchObject({ role: 'member', owner_name: 'Olga', import_job: null });
    expect(m.body.tracks[1].addedBy).toMatchObject({ id: member, name: 'Mia' });
    expect(m.body.tracks[1].addedBy.avatarUrl).toMatch(/^\/pb\/api\/files\/.+\/mia\.png$/);

    for (const who of [outsider, admin]) {
      const r = await call(one.GET, who, { id: shared });
      expect(r.status).toBe(404);
      expect(r.body.tracks).toBeUndefined();
    }
  });

  it('never shows an email address or the invite code to a member', async () => {
    const m = await call(one.GET, member, { id: shared });
    const text = JSON.stringify(m.body);
    expect(text).not.toContain('@');
    expect(text).not.toContain('A'.repeat(32));
  });

  it('a private playlist stays the owner\'s alone, and has no added-by', async () => {
    expect((await call(one.GET, member, { id: secret })).status).toBe(404);
    const o = await call(one.GET, owner, { id: secret });
    expect(o.status).toBe(200);
    expect(o.body.tracks[0].addedBy).toBeUndefined();
  });

  it('a made-up or odd id is a plain 404, nothing else is looked up', async () => {
    for (const id of ['nope', 'x" || user != "', '../x']) {
      expect((await call(one.GET, member, { id })).status).toBe(404);
    }
  });

  it('the library lists shared playlists for members only, with the owner\'s name', async () => {
    const m = await call(list.GET, member);
    expect(m.body.playlists).toEqual([
      expect.objectContaining({ id: shared, role: 'member', owner_name: 'Olga', collaborative: true }),
    ]);
    const o = await call(list.GET, owner);
    expect(o.body.playlists.map((p: { id: string; role: string }) => [p.id, p.role])).toEqual(
      expect.arrayContaining([[shared, 'owner'], [secret, 'owner']]),
    );
    expect((await call(list.GET, outsider)).body.playlists).toEqual([]);
    expect((await call(list.GET, admin)).body.playlists).toEqual([]);
  });
});

describe('what a member may change', () => {
  it('adds a song, marked as theirs, through the server', async () => {
    const r = await call(tracksRoute.POST, member, { id: shared }, { track: song('youtube:new') });
    expect(r.status).toBe(201);
    const row = world.db.playlist_tracks.find((x) => x.track === world.db.tracks.find((t) => t.external_id === 'youtube:new')?.id);
    expect(row).toMatchObject({ playlist: shared, added_by: member, position: 4 });
    expect(world.writes).toContain('server:create:playlist_tracks');
  });

  it('the owner adds with their own session', async () => {
    await call(tracksRoute.POST, owner, { id: shared }, { track: song('youtube:own') });
    expect(world.writes).toContain(`${owner}:create:playlist_tracks`);
  });

  it('removes a song', async () => {
    const r = await call(removeRoute.DELETE, member, { id: shared, trackId: 'youtube:aaa' });
    expect(r.status).toBe(200);
    expect(order(shared)).toEqual(['youtube:bbb', 'youtube:ccc']);
  });

  it('reorders, and the rows are numbered 1, 2, 3 again', async () => {
    const r = await call(moveRoute.POST, member, { id: shared }, { trackId: 'youtube:ccc', to: 0 });
    expect(r.status).toBe(200);
    expect(order(shared)).toEqual(['youtube:ccc', 'youtube:aaa', 'youtube:bbb']);
    expect(world.db.playlist_tracks.filter((x) => x.playlist === shared).map((x) => x.position).sort()).toEqual([1, 2, 3]);
    // Past the end lands last.
    await call(moveRoute.POST, owner, { id: shared }, { trackId: 'youtube:ccc', to: 99 });
    expect(order(shared)).toEqual(['youtube:aaa', 'youtube:bbb', 'youtube:ccc']);
  });

  it('a move needs a song in the playlist and a place', async () => {
    expect((await call(moveRoute.POST, member, { id: shared }, { trackId: 'youtube:zzz', to: 0 })).status).toBe(404);
    expect((await call(moveRoute.POST, member, { id: shared }, { trackId: 'youtube:aaa' })).status).toBe(400);
    expect((await call(moveRoute.POST, member, { id: shared }, { trackId: 'youtube:aaa', to: -1 })).status).toBe(400);
  });

  it('cannot rename, change the cover, delete, or turn collaboration off', async () => {
    const before = JSON.stringify(world.db.playlists);
    expect((await call(one.PATCH, member, { id: shared }, { name: 'Mine now' })).status).toBe(403);
    expect((await call(artworkRoute.PATCH, member, { id: shared })).status).toBe(403);
    expect((await call(one.DELETE, member, { id: shared })).status).toBe(403);
    expect((await call(collabRoute.PATCH, member, { id: shared }, { collaborative: false })).status).toBe(403);
    expect((await call(inviteRoute.POST, member, { id: shared })).status).toBe(403);
    expect((await call(inviteRoute.DELETE, member, { id: shared })).status).toBe(403);
    expect(JSON.stringify(world.db.playlists)).toBe(before);
  });

  it('cannot add or remove other people, or see the invite link or the people list', async () => {
    expect((await call(membersRoute.POST, member, { id: shared }, { userId: outsider })).status).toBe(403);
    world.addMember(shared, outsider);
    expect((await call(memberRoute.DELETE, member, { id: shared, userId: outsider })).status).toBe(403);
    expect((await call(peopleRoute.GET, member, { id: shared })).status).toBe(403);
    const state = await call(collabRoute.GET, member, { id: shared });
    expect(state.status).toBe(200);
    expect('inviteCode' in state.body).toBe(false);
    expect(state.body.members.map((p: { name: string }) => p.name)).toEqual(['Mia', 'Xan']);
  });

  it('can leave even while collaboration is off, so it does not come back later', async () => {
    world.db.playlists.find((p) => p.id === shared)!.collaborative = false;
    expect((await call(memberRoute.DELETE, member, { id: shared, userId: member })).status).toBe(200);
    expect(world.db.playlist_members.some((m) => m.user === member)).toBe(false);
    // Someone who was never on it gets the plain 404.
    expect((await call(memberRoute.DELETE, outsider, { id: shared, userId: outsider })).status).toBe(404);
  });

  it('a removal that fails on the server is an error, not "Removed"', async () => {
    const real = world.server();
    serverOverride = {
      ...real,
      collection: (name: string) =>
        name === 'playlist_members'
          ? { ...real.collection(name), getFirstListItem: async () => Promise.reject(Object.assign(new Error('boom'), { status: 500 })) }
          : real.collection(name),
    };
    expect((await call(memberRoute.DELETE, owner, { id: shared, userId: member })).status).toBe(500);
    expect((await call(memberRoute.DELETE, member, { id: shared, userId: member })).status).toBe(500);
  });

  it('leaves, keeping the songs they added', async () => {
    expect((await call(memberRoute.DELETE, member, { id: shared, userId: member })).status).toBe(200);
    expect((await call(one.GET, member, { id: shared })).status).toBe(404);
    expect(order(shared)).toHaveLength(3);
  });
});

describe('someone who is not a member', () => {
  for (const [label, who] of [['a member of the server', () => outsider], ['an Ember admin', () => admin]] as const) {
    it(`${label} gets 404 for every read and write, and nothing changes`, async () => {
      const before = JSON.stringify(world.db);
      const id = shared;
      const attempts: [unknown, Record<string, string>, unknown?][] = [
        [one.GET, { id }],
        [one.PATCH, { id }, { name: 'x' }],
        [one.DELETE, { id }],
        [artworkRoute.PATCH, { id }],
        [tracksRoute.POST, { id }, { track: song('youtube:evil') }],
        [removeRoute.DELETE, { id, trackId: 'youtube:aaa' }],
        [moveRoute.POST, { id }, { trackId: 'youtube:aaa', to: 2 }],
        [collabRoute.GET, { id }],
        [collabRoute.PATCH, { id }, { collaborative: false }],
        [inviteRoute.POST, { id }],
        [inviteRoute.DELETE, { id }],
        [membersRoute.POST, { id }, { userId: who() }],
        [memberRoute.DELETE, { id, userId: member }],
        [peopleRoute.GET, { id }],
      ];
      for (const [handler, params, body] of attempts) {
        const r = await call(handler, who(), params, body);
        expect(r.status, JSON.stringify(params)).toBe(404);
      }
      // upsertCatalogTrack is never reached either, so no catalog row.
      expect(JSON.stringify(world.db)).toBe(before);
    });
  }
});

describe('the owner', () => {
  it('renames, and a bad name is refused', async () => {
    expect((await call(one.PATCH, owner, { id: shared }, { name: '  Summer  ' })).body.playlist.name).toBe('Summer');
    expect((await call(one.PATCH, owner, { id: shared }, { name: ' ' })).status).toBe(400);
    expect((await call(one.PATCH, owner, { id: shared }, { name: 'x'.repeat(201) })).status).toBe(400);
  });

  it('turns collaboration on: the songs already there become theirs', async () => {
    const r = await call(collabRoute.PATCH, owner, { id: secret }, { collaborative: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ collaborative: true, role: 'owner', inviteCode: null, members: [] });
    expect(world.db.playlist_tracks.filter((x) => x.playlist === secret).map((x) => x.added_by)).toEqual([owner]);
  });

  it('turns it off: the link dies and members lose access, but stay listed for next time', async () => {
    const off = await call(collabRoute.PATCH, owner, { id: shared }, { collaborative: false });
    expect(off.body).toMatchObject({ collaborative: false, inviteCode: null });
    expect((await call(one.GET, member, { id: shared })).status).toBe(404);
    expect((await call(list.GET, member)).body.playlists).toEqual([]);
    expect((await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) })).status).toBe(404);
    await call(collabRoute.PATCH, owner, { id: shared }, { collaborative: true });
    expect((await call(one.GET, member, { id: shared })).status).toBe(200);
  });

  it('makes, replaces and turns off the invite link', async () => {
    const made = await call(inviteRoute.POST, owner, { id: shared });
    expect(made.body.inviteCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(made.body.inviteCode).not.toBe('A'.repeat(32));
    expect((await call(collabRoute.GET, owner, { id: shared })).body.inviteCode).toBe(made.body.inviteCode);
    // The old link stopped working.
    expect((await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) })).status).toBe(404);
    expect((await call(inviteRoute.DELETE, owner, { id: shared })).body.inviteCode).toBeNull();
    expect((await call(joinRoute.POST, outsider, {}, { code: made.body.inviteCode })).status).toBe(404);
    expect((await call(inviteRoute.POST, owner, { id: secret })).status).toBe(409);
  });

  it('adds and removes people', async () => {
    const added = await call(membersRoute.POST, owner, { id: shared }, { userId: outsider });
    expect(added.body.members.map((p: { name: string }) => p.name)).toEqual(['Mia', 'Xan']);
    expect((await call(one.GET, outsider, { id: shared })).status).toBe(200);
    // Twice is fine.
    expect((await call(membersRoute.POST, owner, { id: shared }, { userId: outsider })).status).toBe(200);
    expect((await call(memberRoute.DELETE, owner, { id: shared, userId: outsider })).status).toBe(200);
    expect((await call(one.GET, outsider, { id: shared })).status).toBe(404);
  });

  it('removing someone while the link is on replaces the link, so they cannot walk back in', async () => {
    await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) });
    const removed = await call(memberRoute.DELETE, owner, { id: shared, userId: outsider });
    expect(removed.body.inviteCode).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) })).status).toBe(404);
    expect((await call(one.GET, outsider, { id: shared })).status).toBe(404);
    // With the link off there is nothing to replace.
    await call(inviteRoute.DELETE, owner, { id: shared });
    const again = await call(memberRoute.DELETE, owner, { id: shared, userId: member });
    expect(again.body).toEqual({ ok: true });
  });

  it('cannot add themselves, an unknown id, or anyone to a private playlist', async () => {
    expect((await call(membersRoute.POST, owner, { id: shared }, { userId: owner })).status).toBe(400);
    expect((await call(membersRoute.POST, owner, { id: shared }, { userId: 'nosuchuser00000' })).status).toBe(404);
    expect((await call(membersRoute.POST, owner, { id: shared }, { userId: 'a" || "' })).status).toBe(400);
    expect((await call(membersRoute.POST, owner, { id: secret }, { userId: member })).status).toBe(409);
    expect((await call(memberRoute.DELETE, owner, { id: shared, userId: owner })).status).toBe(400);
  });

  it('stops at 50 people', async () => {
    for (let i = 0; i < 49; i++) world.addMember(shared, world.addUser(`P${i}`).id);
    const last = world.addUser('Late').id;
    expect((await call(membersRoute.POST, owner, { id: shared }, { userId: last })).status).toBe(409);
  });

  it('sees names in the people list, and emails only as an admin', async () => {
    const plain = await call(peopleRoute.GET, owner, { id: shared });
    expect(plain.body.people.map((p: { name: string }) => p.name)).toEqual(['Ada', 'Mia', 'Xan']);
    expect(JSON.stringify(plain.body)).not.toContain('@');

    const adminsOwn = world.addPlaylist(admin, 'Admin mix', { collaborative: true }).id;
    const asAdmin = await call(peopleRoute.GET, admin, { id: adminsOwn });
    expect(asAdmin.body.people.find((p: { name: string }) => p.name === 'Mia').email).toBe('mia@ember.test');
  });

  it('deletes it', async () => {
    expect((await call(one.DELETE, owner, { id: shared })).status).toBe(200);
    expect((await call(one.GET, member, { id: shared })).status).toBe(404);
  });
});

describe('the invite link', () => {
  it('adds whoever opens it once; again is harmless; the owner is not added', async () => {
    const first = await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) });
    expect(first.body).toEqual({ playlistId: shared, joined: true });
    expect((await call(joinRoute.POST, outsider, {}, { code: 'A'.repeat(32) })).body).toEqual({ playlistId: shared, joined: false });
    expect((await call(joinRoute.POST, owner, {}, { code: 'A'.repeat(32) })).body).toEqual({ playlistId: shared, joined: false });
    expect(world.db.playlist_members.filter((m) => m.playlist === shared)).toHaveLength(2);
    expect((await call(one.GET, outsider, { id: shared })).status).toBe(200);
  });

  it('a missing, short or odd code never reaches a lookup (an empty one would match every private playlist)', async () => {
    for (const code of [undefined, '', 'short', 'A'.repeat(31) + '"', { $ne: '' }]) {
      const r = await call(joinRoute.POST, outsider, {}, { code });
      expect(r.status).toBe(404);
    }
    expect(world.db.playlist_members.some((m) => m.user === outsider)).toBe(false);
  });

  it('a code two playlists share is refused rather than guessed', async () => {
    world.addPlaylist(outsider, 'Copycat', { collaborative: true, invite_code: 'A'.repeat(32) });
    expect((await call(joinRoute.POST, member, {}, { code: 'A'.repeat(32) })).status).toBe(404);
  });
});
