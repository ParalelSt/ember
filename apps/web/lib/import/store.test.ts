import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { addTrackAt, createImportJob, pickItem, skipItem } from '@/lib/import/store';
import { itemFromRecord, jobFromRecord } from '@/lib/import/records';
import type { ImportCandidate, SourceItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn() } }));

// A small in-memory PocketBase: enough of the SDK for the import store
// (create, update, delete, getOne, getFirstListItem, getFullList), with
// `a = "b" && c = "d"` filters and playlist_tracks' (playlist, track)
// unique index.

type Rec = Record<string, unknown> & { id: string };

function fakePb() {
  const db: Record<string, Rec[]> = {};
  let n = 0;
  const table = (name: string) => (db[name] ??= []);
  const notFound = () => Object.assign(new Error('not found'), { status: 404 });
  const matches = (r: Rec, filter?: string) =>
    !filter ||
    filter.split('&&').every((clause) => {
      const m = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/.exec(clause);
      if (!m) throw new Error(`fake pb cannot read filter: ${clause}`);
      return String(r[m[1]] ?? '') === m[2];
    });
  const collection = (name: string) => ({
    async create(data: Record<string, unknown>) {
      if (name === 'playlist_tracks' && table(name).some((r) => r.playlist === data.playlist && r.track === data.track)) {
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
