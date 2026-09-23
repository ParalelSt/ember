import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { addTrackAt, createImportJob, createJobStore, likeTrack, pickItem, skipItem } from '@/lib/import/store';
import { parseYtmusicLiked } from '@/lib/import/sources/ytmusicLiked';
import { GOOGLE_LIKES_SOURCE_ID } from '@/lib/import/musicCheck';
import { itemFromRecord, jobFromRecord } from '@/lib/import/records';
import type { ImportCandidate, SourceItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn() } }));

// A small in-memory PocketBase: enough of the SDK for the import store
// (create, update, delete, getOne, getFirstListItem, getFullList, getList),
// with `a = "b" && c != "d"` filters, playlist_tracks' (playlist, track)
// unique index and likes' (user, track) one.

type Rec = Record<string, unknown> & { id: string };

function fakePb() {
  const db: Record<string, Rec[]> = {};
  let n = 0;
  const table = (name: string) => (db[name] ??= []);
  const notFound = () => Object.assign(new Error('not found'), { status: 404 });
  const matches = (r: Rec, filter?: string) =>
    !filter ||
    filter.split('&&').every((clause) => {
      const m = /^\s*(\w+)\s*(!?=)\s*"([^"]*)"\s*$/.exec(clause);
      if (!m) throw new Error(`fake pb cannot read filter: ${clause}`);
      const same = String(r[m[1]] ?? '') === m[3];
      return m[2] === '=' ? same : !same;
    });
  const collection = (name: string) => ({
    async create(data: Record<string, unknown>) {
      if (name === 'playlist_tracks' && table(name).some((r) => r.playlist === data.playlist && r.track === data.track)) {
        throw Object.assign(new Error('unique'), { status: 400 });
      }
      if (name === 'likes' && table(name).some((r) => r.user === data.user && r.track === data.track)) {
        throw Object.assign(new Error('unique'), { status: 400 });
      }
      const rec = { id: `r${++n}`, created: String(n), ...data } as Rec;
      table(name).push(rec);
      return rec;
    },
    async update(id: string, data: Record<string, unknown>) {
      const rec = table(name).find((r) => r.id === id);
      if (!rec) throw notFound();
      if (
        name === 'playlist_tracks' &&
        data.track &&
        table(name).some((r) => r.id !== id && r.playlist === rec.playlist && r.track === data.track)
      ) {
        throw Object.assign(new Error('unique'), { status: 400 });
      }
      Object.assign(rec, data);
      return rec;
    },
    async delete(id: string) {
      db[name] = table(name).filter((r) => r.id !== id);
      if (name === 'playlists') {
        const jobs = table('import_jobs').filter((j) => j.playlist === id).map((j) => j.id);
        db.import_jobs = table('import_jobs').filter((j) => !jobs.includes(j.id));
        db.import_items = table('import_items').filter((i) => !jobs.includes(String(i.job)));
      }
      // A job's items cascade with it.
      if (name === 'import_jobs') db.import_items = table('import_items').filter((i) => i.job !== id);
      return true;
    },
    async getOne(id: string) {
      const rec = table(name).find((r) => r.id === id);
      if (!rec) throw notFound();
      return rec;
    },
    async getFirstListItem(filter: string) {
      const rec = table(name).find((r) => matches(r, filter));
      if (!rec) throw notFound();
      return rec;
    },
    async getFullList(opts: { filter?: string } = {}) {
      return table(name).filter((r) => matches(r, opts.filter));
    },
    async getList(_page: number, perPage: number, opts: { filter?: string; sort?: string } = {}) {
      const rows = table(name).filter((r) => matches(r, opts.filter));
      const sort = opts.sort ?? '';
      const key = sort.replace('-', '');
      if (key) {
        rows.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (sort.startsWith('-') ? -1 : 1));
      }
      return { items: rows.slice(0, perPage) };
    },
  });
  const pb = { collection, autoCancellation: vi.fn() } as unknown as PocketBase;
  return { pb, db, table };
}

const track = (id: string, title = id): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: `/api/youtube/stream/${id}`,
});

const source = (position: number): SourceItem => ({
  position,
  title: `Song ${position}`,
  artists: ['A'],
  artist: 'A',
  durationMs: 200_000,
  explicit: false,
  uri: `spotify:track:${position}`,
});

const cand = (id: string, score: number): ImportCandidate => ({
  track: track(id),
  artists: ['A'],
  videoType: 'ATV',
  explicit: false,
  score,
  reasons: ['Same title'],
});

/** The playlist's tracks in the order the playlist page shows them. */
function order(db: ReturnType<typeof fakePb>, playlistId: string) {
  const rows = db.table('playlist_tracks').filter((r) => r.playlist === playlistId);
  return rows
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => String(db.table('tracks').find((t) => t.id === r.track)?.source_id));
}

async function setup(total = 6) {
  const f = fakePb();
  const { job, playlistId } = await createImportJob(f.pb, {
    userId: 'u1',
    source: 'spotify',
    sourceId: 'sp1',
    sourceUrl: 'https://open.spotify.com/playlist/sp1',
    name: 'Road trip',
    coverUrl: null,
    items: Array.from({ length: total }, (_, i) => source(i)),
  });
  if (!playlistId) throw new Error('a playlist import must make its playlist');
  return { f, job, playlistId };
}

describe('createImportJob', () => {
  it('creates the playlist, a queued job and one pending item per source track', async () => {
    const { f, job, playlistId } = await setup(6);
    expect(job.status).toBe('queued');
    expect(job.total).toBe(6);
    const playlist = f.table('playlists')[0];
    expect(playlist).toMatchObject({ id: playlistId, name: 'Road trip', import_job: job.id, user: 'u1' });
    const items = f.table('import_items').map(itemFromRecord);
    expect(items.map((i) => [i.position, i.status])).toEqual([0, 1, 2, 3, 4, 5].map((p) => [p, 'pending']));
    expect(items[2].source).toMatchObject({ title: 'Song 2', explicit: false, uri: 'spotify:track:2' });
  });

  it('a YouTube Music playlist arrives with its own tracks as ready candidates', async () => {
    const f = fakePb();
    await createImportJob(f.pb, {
      userId: 'u1',
      source: 'ytmusic',
      sourceId: 'PL1',
      sourceUrl: 'https://music.youtube.com/playlist?list=PL1',
      name: 'Mix',
      coverUrl: null,
      tracks: [track('aaaaaaaaaaa'), track('bbbbbbbbbbb')],
    });
    const items = f.table('import_items').map(itemFromRecord);
    expect(items.map((i) => i.candidates[0]?.track.sourceId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(items.every((i) => i.status === 'pending' && i.candidates[0].score === 100)).toBe(true);
  });

  it('removes the half-made playlist when an item cannot be written', async () => {
    const f = fakePb();
    const real = f.pb.collection.bind(f.pb) as unknown as (name: string) => Record<string, (...a: never[]) => unknown>;
    let made = 0;
    (f.pb as unknown as { collection: unknown }).collection = (name: string) => {
      const c = real(name) as unknown as { create: (d: Record<string, unknown>) => Promise<unknown> };
      if (name !== 'import_items') return c;
      return {
        ...c,
        create: async (d: Record<string, unknown>) => {
          if (++made === 3) throw new Error('PocketBase is down');
          return c.create(d);
        },
      };
    };
    await expect(
      createImportJob(f.pb, {
        userId: 'u1',
        source: 'spotify',
        sourceId: 'sp1',
        sourceUrl: 'x',
        name: 'Broken',
        coverUrl: null,
        items: [source(0), source(1), source(2), source(3)],
      }),
    ).rejects.toThrow('PocketBase is down');
    expect(f.table('playlists')).toHaveLength(0);
    expect(f.table('import_jobs')).toHaveLength(0);
  });
});

describe('position-preserving inserts', () => {
  it('addTrackAt puts tracks at their source position whatever the order they arrive in', async () => {
    const { f, playlistId } = await setup(6);
    for (const p of [0, 1, 3, 5]) await addTrackAt(f.pb, playlistId, p + 1, track(`vid${p}`));
    // The review picks come later, for positions 2 and 4.
    await addTrackAt(f.pb, playlistId, 5, track('vid4'));
    await addTrackAt(f.pb, playlistId, 3, track('vid2'));
    expect(order(f, playlistId)).toEqual(['vid0', 'vid1', 'vid2', 'vid3', 'vid4', 'vid5']);
  });

  it('the same song twice is a no-op, not an error', async () => {
    const { f, playlistId } = await setup(2);
    await addTrackAt(f.pb, playlistId, 1, track('same'));
    await addTrackAt(f.pb, playlistId, 2, track('same'));
    expect(order(f, playlistId)).toEqual(['same']);
  });
});

describe('pickItem and skipItem', () => {
  async function withItems() {
    const s = await setup(4);
    const items = s.f.table('import_items');
    // What the runner left: 0 and 3 accepted, 1 needs review, 2 not found.
    const statuses = ['accepted', 'review', 'missing', 'accepted'];
    items.forEach((r, i) => {
      Object.assign(r, {
        status: statuses[i],
        video_id: statuses[i] === 'accepted' ? `vid${i}` : '',
        candidates: [cand(`vid${i}`, 90), cand(`alt${i}`, 60)],
      });
    });
    await addTrackAt(s.f.pb, s.playlistId, 1, track('vid0'));
    await addTrackAt(s.f.pb, s.playlistId, 4, track('vid3'));
    const job = () => jobFromRecord(s.f.table('import_jobs')[0]);
    const item = (i: number) => itemFromRecord(s.f.table('import_items')[i]);
    return { ...s, job, item };
  }

  it('a review pick lands at the song source position and resolves the item', async () => {
    const s = await withItems();
    await pickItem(s.f.pb, s.job(), s.item(1), track('alt1'));
    expect(order(s.f, s.playlistId)).toEqual(['vid0', 'alt1', 'vid3']);
    expect(s.item(1)).toMatchObject({ status: 'resolved', videoId: 'alt1' });
    expect(s.job()).toMatchObject({ accepted: 3, review: 0, missing: 1 });
  });

  it('a re-match swaps the old track out in place', async () => {
    const s = await withItems();
    await pickItem(s.f.pb, s.job(), s.item(0), track('alt0'));
    expect(order(s.f, s.playlistId)).toEqual(['alt0', 'vid3']);
    expect(s.item(0)).toMatchObject({ status: 'resolved', videoId: 'alt0' });
  });

  it('a re-match to a song already in the playlist drops the wrong copy', async () => {
    const s = await withItems();
    await pickItem(s.f.pb, s.job(), s.item(0), track('vid3'));
    expect(order(s.f, s.playlistId)).toEqual(['vid3']);
  });

  it('a song found by search joins the candidates, so it can be re-picked later', async () => {
    const s = await withItems();
    await pickItem(s.f.pb, s.job(), s.item(2), track('found'));
    const it = s.item(2);
    expect(it.candidates.map((c) => c.track.sourceId)).toEqual(['vid2', 'alt2', 'found']);
    expect(it.candidates[2].reasons).toEqual(['Picked from search']);
  });

  it('skip leaves the song out and updates the counts', async () => {
    const s = await withItems();
    await skipItem(s.f.pb, s.job(), s.item(2));
    expect(s.item(2).status).toBe('skipped');
    expect(s.job()).toMatchObject({ accepted: 2, review: 1, missing: 0 });
  });
});

// A transfer (kind: 'liked'): no playlist, dated items, likes instead of
// playlist rows.
describe('a transfer into the likes', () => {
  async function transfer(over: Partial<Parameters<typeof createImportJob>[1]> = {}, total = 4) {
    const f = fakePb();
    const { job, playlistId } = await createImportJob(f.pb, {
      userId: 'u1',
      source: 'csv',
      sourceId: 'upload',
      sourceUrl: '',
      name: 'Liked songs from Spotify',
      coverUrl: null,
      kind: 'liked',
      order: 'newest-first',
      items: Array.from({ length: total }, (_, i) => source(i)),
      ...over,
    });
    return { f, job, playlistId };
  }

  const likedAt = (f: ReturnType<typeof fakePb>) =>
    f
      .table('import_items')
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((r) => itemFromRecord(r).likedAt);

  it('makes no playlist, only the job and its items', async () => {
    const { f, job, playlistId } = await transfer();
    expect(playlistId).toBeNull();
    expect(f.table('playlists')).toHaveLength(0);
    expect(job).toMatchObject({ kind: 'liked', playlistId: null, status: 'queued', total: 4, existing: 0 });
    expect(f.table('import_items')).toHaveLength(4);
  });

  it('dates every song below the oldest like the person already has, in source order', async () => {
    const f = fakePb();
    await f.pb.collection('likes').create({ user: 'u1', track: 'other', liked_at: '2025-01-01 00:00:00.000Z' });
    const { job } = await createImportJob(f.pb, {
      userId: 'u1',
      source: 'paste',
      sourceId: 'paste',
      sourceUrl: '',
      name: 'A pasted list',
      coverUrl: null,
      kind: 'liked',
      order: 'newest-first',
      items: [source(0), source(1), source(2)],
    });
    expect(job.kind).toBe('liked');
    const dates = likedAt(f);
    const oldest = Date.parse('2025-01-01T00:00:00.000Z');
    expect(dates.every((d) => d !== null && d < oldest)).toBe(true);
    expect(dates[0]! - dates[1]!).toBe(1000);
    expect(dates[1]! - dates[2]!).toBe(1000);
  });

  it('keeps the time the source gave where it gave one', async () => {
    const stamped = Date.UTC(2024, 4, 5, 6, 7, 8);
    const { f } = await transfer({ items: [{ ...source(0), likedAt: stamped }, { ...source(1), likedAt: stamped - 1000 }] }, 2);
    expect(likedAt(f)).toEqual([stamped, stamped - 1000]);
  });

  it('turns an oldest-first source around, so the list still reads newest first', async () => {
    const { f } = await transfer({ order: 'oldest-first' }, 3);
    const dates = likedAt(f);
    expect(dates[2]! - dates[1]!).toBe(1000);
    expect(dates[1]! - dates[0]!).toBe(1000);
  });

  it('removes the half-made job when an item cannot be written', async () => {
    const f = fakePb();
    const real = f.pb.collection.bind(f.pb) as unknown as (name: string) => Record<string, (...a: never[]) => unknown>;
    let made = 0;
    (f.pb as unknown as { collection: unknown }).collection = (name: string) => {
      const c = real(name) as unknown as { create: (d: Record<string, unknown>) => Promise<unknown> };
      if (name !== 'import_items') return c;
      return {
        ...c,
        create: async (d: Record<string, unknown>) => {
          if (++made === 3) throw new Error('PocketBase is down');
          return c.create(d);
        },
      };
    };
    await expect(
      createImportJob(f.pb, {
        userId: 'u1',
        source: 'csv',
        sourceId: 'upload',
        sourceUrl: '',
        name: 'Broken transfer',
        coverUrl: null,
        kind: 'liked',
        items: [source(0), source(1), source(2), source(3)],
      }),
    ).rejects.toThrow('PocketBase is down');
    expect(f.table('import_jobs')).toHaveLength(0);
    expect(f.table('import_items')).toHaveLength(0);
    expect(f.table('playlists')).toHaveLength(0);
  });
});

describe('likeTrack', () => {
  it('likes a song as an import, at the date it was given', async () => {
    const f = fakePb();
    const at = Date.UTC(2020, 0, 2, 3, 4, 5);
    expect(await likeTrack(f.pb, 'u1', track('vid0'), at)).toEqual({ created: true });
    expect(f.table('likes')[0]).toMatchObject({ user: 'u1', origin: 'import', liked_at: '2020-01-02 03:04:05.000Z' });
  });

  it('a song the person already liked is not an error and not a new like', async () => {
    const f = fakePb();
    await likeTrack(f.pb, 'u1', track('vid0'), 1);
    expect(await likeTrack(f.pb, 'u1', track('vid0'), 2)).toEqual({ created: false });
    expect(f.table('likes')).toHaveLength(1);
  });
});

describe('pickItem and skipItem on a transfer', () => {
  async function withItems() {
    const f = fakePb();
    const { job } = await createImportJob(f.pb, {
      userId: 'u1',
      source: 'csv',
      sourceId: 'upload',
      sourceUrl: '',
      name: 'Liked songs from Spotify',
      coverUrl: null,
      kind: 'liked',
      items: [source(0), source(1), source(2)],
    });
    // What the runner left: 0 accepted (and liked), 1 unsure, 2 not found.
    const statuses = ['accepted', 'review', 'missing'];
    f.table('import_items').forEach((r, i) => {
      Object.assign(r, {
        status: statuses[i],
        video_id: statuses[i] === 'accepted' ? `vid${i}` : '',
        candidates: [cand(`vid${i}`, 90), cand(`alt${i}`, 60)],
      });
    });
    await likeTrack(f.pb, 'u1', track('vid0'), 1_000);
    const freshJob = () => jobFromRecord(f.table('import_jobs')[0]);
    const item = (i: number) => itemFromRecord(f.table('import_items')[i]);
    const liked = () =>
      f.table('likes').map((l) => String(f.table('tracks').find((t) => t.id === l.track)?.source_id));
    return { f, job, freshJob, item, liked };
  }

  it('a pick for an unsure song likes it, at the date the item carries', async () => {
    const s = await withItems();
    const before = s.item(1).likedAt;
    await pickItem(s.f.pb, s.freshJob(), s.item(1), track('alt1'));
    expect(s.liked()).toEqual(['vid0', 'alt1']);
    expect(s.item(1)).toMatchObject({ status: 'resolved', videoId: 'alt1' });
    expect(s.freshJob()).toMatchObject({ accepted: 2, review: 0, missing: 1 });
    const picked = s.f.table('tracks').find((t) => t.source_id === 'alt1');
    const row = s.f.table('likes').find((l) => l.track === picked?.id);
    expect(Date.parse(String(row?.liked_at).replace(' ', 'T'))).toBe(before);
  });

  it('a re-match unlikes the song this transfer got wrong', async () => {
    const s = await withItems();
    await pickItem(s.f.pb, s.freshJob(), s.item(0), track('alt0'));
    expect(s.liked()).toEqual(['alt0']);
  });

  it('a like the person made themselves is never removed by a re-match', async () => {
    const s = await withItems();
    // They had liked the wrong guess for their own reasons.
    s.f.table('likes').forEach((l) => Object.assign(l, { origin: 'user' }));
    await pickItem(s.f.pb, s.freshJob(), s.item(0), track('alt0'));
    expect(s.liked().sort()).toEqual(['alt0', 'vid0']);
  });

  it('Remove song on a transfer leaves the likes alone', async () => {
    const s = await withItems();
    await skipItem(s.f.pb, s.freshJob(), s.item(2));
    expect(s.item(2).status).toBe('skipped');
    expect(s.liked()).toEqual(['vid0']);
  });
});

// A Google likes transfer through the store. YouTube Music has already said
// what each like is (before the preview), so the job is created with a song
// pending for the runner, an upload waiting in review and a like that is not
// music skipped: counted, never shown.
describe('a Google likes transfer, through the store', () => {
  async function googleJob() {
    const f = fakePb();
    const parsed = parseYtmusicLiked([
      { track: track('vid0000000a', 'A song'), artists: ['A'], likedAt: null, videoType: 'ATV' },
      { track: track('vid0000000c', 'A Minecraft video'), artists: ['A'], likedAt: null, videoType: null },
      { track: track('vid0000000b', 'An upload'), artists: ['A'], likedAt: null, videoType: 'UGC' },
    ]);
    const { job } = await createImportJob(f.pb, {
      userId: 'u1',
      source: 'ytmusic',
      sourceId: GOOGLE_LIKES_SOURCE_ID,
      sourceUrl: '',
      name: parsed.label,
      coverUrl: null,
      kind: 'liked',
      order: parsed.order,
      items: parsed.items,
    });
    const store = createJobStore(async () => f.pb);
    const item = (i: number) => itemFromRecord(f.table('import_items').sort((a, b) => Number(a.position) - Number(b.position))[i]);
    const freshJob = () => jobFromRecord(f.table('import_jobs')[0]);
    const liked = () => f.table('likes').map((l) => String(f.table('tracks').find((t) => t.id === l.track)?.source_id));
    return { f, job, store, item, freshJob, liked };
  }

  it('is created already sorted: the song pending, the upload in review, the rest skipped at the end', async () => {
    const g = await googleJob();
    expect(g.job).toMatchObject({ kind: 'liked', source: 'ytmusic', total: 3, review: 1, notMusic: 0 });
    expect([0, 1, 2].map((i) => [g.item(i).source.title, g.item(i).status])).toEqual([
      ['A song', 'pending'],
      ['An upload', 'review'],
      ['A Minecraft video', 'skipped'],
    ]);
    expect(g.item(1).candidates).toHaveLength(1);
    expect(g.item(1).candidates[0]).toMatchObject({ videoType: 'UGC', track: { sourceId: 'vid0000000b' } });
    expect(g.item(1).confidence).toBe(100);
  });

  /** What the runner does: likes the one pending song and finishes. */
  async function run(g: Awaited<ReturnType<typeof googleJob>>) {
    const song = g.item(0);
    await g.store.like('u1', song.candidates[0].track, song.likedAt);
    await g.store.saveResults([
      { itemId: song.id, position: 0, status: 'accepted', videoId: 'vid0000000a', confidence: 100, candidates: song.candidates, likedAt: song.likedAt },
    ]);
    await g.store.updateJob(g.job.id, { ...(await g.store.counts(g.job.id)), cursor: 3, status: 'done' });
  }

  it('a song is liked, the upload waits for a check, and the like that is not music is only counted', async () => {
    const g = await googleJob();
    await run(g);
    expect(g.liked()).toEqual(['vid0000000a']);
    expect(g.freshJob()).toMatchObject({ accepted: 1, review: 1, missing: 0, notMusic: 1 });

    // Yes in the review sheet: the upload is liked like any song.
    await pickItem(g.f.pb, g.freshJob(), g.item(1), g.item(1).candidates[0].track);
    expect(g.liked()).toEqual(['vid0000000a', 'vid0000000b']);
    expect(g.freshJob()).toMatchObject({ accepted: 2, review: 0, notMusic: 1 });
  });

  it('no in the review sheet counts the upload as not music', async () => {
    const g = await googleJob();
    await run(g);
    await skipItem(g.f.pb, g.freshJob(), g.item(1));
    expect(g.item(1).status).toBe('skipped');
    expect(g.liked()).toEqual(['vid0000000a']);
    expect(g.freshJob()).toMatchObject({ accepted: 1, review: 0, notMusic: 2 });
  });
});
