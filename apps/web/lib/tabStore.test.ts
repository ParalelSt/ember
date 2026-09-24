// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordModel } from 'pocketbase';
import { fakePocketBase } from '@/test-utils/fakePocketBase';
import {
  backfillPatch,
  backfillTabRows,
  canDelete,
  canView,
  deletePrivateTabs,
  findTabs,
  hintsFor,
  mapTab,
  matchesQuery,
  orderSources,
  recordGenerated,
  resetBackfill,
  songKeyOf,
  sortTabs,
  type TabViewer,
} from './tabStore';
import type { SongsterrSongHint } from './songsterr';

const ALICE: TabViewer = { id: 'alice', isAdmin: false };
const BOB: TabViewer = { id: 'bob', isAdmin: false };
const ADMIN: TabViewer = { id: 'root', isAdmin: true };

const row = (r: Partial<RecordModel> & Record<string, unknown>) => r as RecordModel;

const SONG: SongsterrSongHint = {
  songId: 42,
  artist: 'Metallica',
  title: 'Master of Puppets',
  hasChords: false,
  tracks: [{ instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 40], difficulty: 3 }],
};

beforeEach(() => {
  resetBackfill();
});

describe('song keys and matching', () => {
  it('uses lib/songKey, so version noise collapses', () => {
    expect(songKeyOf({ title: 'Master of Puppets (Remastered 2017)', artist: 'Metallica' })).toBe(
      songKeyOf({ title: 'Master of Puppets', artist: 'Metallica' }),
    );
  });

  it('matches by song_key, and by the exact track it was added for', () => {
    const tab = row({ song_key: 'master of puppets::::metallica', track_key: 'youtube:abc' });
    expect(matchesQuery(tab, { title: 'Master of Puppets [Official Video]', artist: 'Metallica' })).toBe(true);
    expect(matchesQuery(tab, { title: 'Wonderwall', artist: 'Oasis' })).toBe(false);
    expect(matchesQuery(tab, { title: 'Totally different', trackId: 'youtube:abc' })).toBe(true);
    expect(matchesQuery(tab, { title: 'Master of Puppets', artist: 'Someone Else' })).toBe(false);
  });

  it('lets an unknown artist on either side through on a title match', () => {
    expect(matchesQuery(row({ song_key: 'one::::' }), { title: 'One', artist: 'Metallica' })).toBe(true);
    expect(matchesQuery(row({ song_key: 'one::::metallica' }), { title: 'One' })).toBe(true);
  });

  it('computes the key from title and artist for a row that has none yet', () => {
    expect(matchesQuery(row({ title: 'One (Live)', artist: 'Metallica' }), { title: 'One', artist: 'Metallica' })).toBe(true);
  });
});

describe('visibility and delete permission', () => {
  const shared = row({ id: 't1', user: 'alice', shared: true });
  const priv = row({ id: 't2', user: 'alice', shared: false });
  const orphan = row({ id: 't3', user: '', shared: true, kind: 'generated' });

  it('a shared tab is visible to everyone, a private one only to its uploader', () => {
    expect(canView(shared, BOB)).toBe(true);
    expect(canView(priv, ALICE)).toBe(true);
    expect(canView(priv, BOB)).toBe(false);
  });

  it('only the uploader or an admin can delete', () => {
    expect(canDelete(shared, ALICE)).toBe(true);
    expect(canDelete(shared, BOB)).toBe(false);
    expect(canDelete(shared, ADMIN)).toBe(true);
    // A generated tab recorded after the fact has nobody to name.
    expect(canDelete(orphan, BOB)).toBe(false);
    expect(canDelete(orphan, ADMIN)).toBe(true);
  });

  it('mapTab tells the client what it may do', () => {
    expect(mapTab(shared, ALICE)).toMatchObject({ mine: true, canDelete: true, shared: true, kind: 'file' });
    expect(mapTab(shared, BOB)).toMatchObject({ mine: false, canDelete: false });
    expect(mapTab(shared, BOB).downloadUrl).toBe('/api/tabs/files/t1/download');
    expect(mapTab(row({ ...orphan, track_key: 'upload:x1', file: 'upload-x1.alphatex' }), BOB)).toMatchObject({
      kind: 'generated',
      format: 'alphatex',
      downloadUrl: '/api/tabs/generated/upload%3Ax1',
    });
  });
});

describe('source priority', () => {
  it('sorts files before generated tabs, newest first inside each', () => {
    const sorted = sortTabs([
      row({ id: 'g', kind: 'generated', created: '2026-09-03' }),
      row({ id: 'f-old', kind: 'file', created: '2026-09-01' }),
      row({ id: 'f-new', kind: 'file', created: '2026-09-02' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['f-new', 'f-old', 'g']);
  });

  it('orders the chain file > generated > Songsterr link', () => {
    const g = mapTab(row({ id: 'g', kind: 'generated', track_key: 'upload:x', file: 'upload-x.alphatex' }), ALICE);
    const f = mapTab(row({ id: 'f', kind: 'file', file: 'a.gp5' }), ALICE);
    const link = { id: 42, artist: 'A', title: 'B', hasChords: false, instruments: [], url: 'https://x' };
    expect(orderSources([g, f], [link]).map((s) => s.type)).toEqual(['file', 'generated', 'songsterr']);
    expect(orderSources([], [link]).map((s) => s.type)).toEqual(['songsterr']);
  });

  it('a pasted text tab sits between files and generated tabs', () => {
    const sorted = sortTabs([
      row({ id: 'g', kind: 'generated', created: '2026-09-05' }),
      row({ id: 'p', kind: 'pasted', created: '2026-09-04' }),
      row({ id: 'f', kind: 'file', created: '2026-09-01' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['f', 'p', 'g']);
    const g = mapTab(row({ id: 'g', kind: 'generated', track_key: 'upload:x', file: 'upload-x.alphatex' }), ALICE);
    const p = mapTab(row({ id: 'p', kind: 'pasted', file: 'abc.alphatex', format: 'alphatex' }), ALICE);
    const f = mapTab(row({ id: 'f', kind: 'file', file: 'a.gp5' }), ALICE);
    const link = { id: 42, artist: 'A', title: 'B', hasChords: false, instruments: [], url: 'https://x' };
    expect(orderSources([g, p, f], [link]).map((s) => s.type)).toEqual(['file', 'pasted', 'generated', 'songsterr']);
  });

  it('a pasted row maps to kind pasted, loaded through the file download route', () => {
    expect(mapTab(row({ id: 'p', kind: 'pasted', file: 'abc.alphatex', format: 'alphatex', user: 'alice', shared: true }), ALICE)).toMatchObject({
      kind: 'pasted',
      format: 'alphatex',
      ext: '.alphatex',
      mine: true,
      canDelete: true,
      downloadUrl: '/api/tabs/files/p/download',
    });
  });
});

describe('findTabs', () => {
  const seed = () =>
    fakePocketBase({
      tabs: [
        { id: 'a-shared', user: 'alice', shared: true, kind: 'file', format: 'gp5', file: 'a.gp5', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica', created: '2026-09-02' },
        { id: 'a-private', user: 'alice', shared: false, kind: 'file', format: 'gp5', file: 'b.gp5', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica', created: '2026-09-01' },
        { id: 'gen', user: '', shared: true, kind: 'generated', format: 'alphatex', file: 'youtube-abc.alphatex', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica', track_key: 'youtube:abc', created: '2026-09-03' },
        { id: 'other', user: 'bob', shared: true, kind: 'file', format: 'gp5', file: 'c.gp5', title: 'Wonderwall', artist: 'Oasis', song_key: 'wonderwall::::oasis', created: '2026-09-04' },
      ],
    });

  it('finds a song by song_key and hides private tabs of other members', async () => {
    const { pb } = seed();
    const q = { title: 'Master of Puppets (Remastered)', artist: 'Metallica' };
    expect((await findTabs(pb, ALICE, q)).map((r) => r.id)).toEqual(['a-shared', 'a-private', 'gen']);
    expect((await findTabs(pb, BOB, q)).map((r) => r.id)).toEqual(['a-shared', 'gen']);
  });

  it('narrows by kind', async () => {
    const { pb } = seed();
    const q = { title: 'Master of Puppets', artist: 'Metallica' };
    expect((await findTabs(pb, BOB, q, { kind: 'file' })).map((r) => r.id)).toEqual(['a-shared']);
    expect((await findTabs(pb, BOB, q, { kind: 'generated' })).map((r) => r.id)).toEqual(['gen']);
  });

  it('with no song lists every tab you can see', async () => {
    const { pb } = seed();
    expect((await findTabs(pb, BOB, {}, { kind: 'file' })).map((r) => r.id).sort()).toEqual(['a-shared', 'other']);
  });

  it('an artist alone names no song', async () => {
    const { pb } = seed();
    expect(await findTabs(pb, ALICE, { artist: 'Metallica' })).toEqual([]);
  });

  it('never shows a private tab even if the filter lets it through', async () => {
    const { pb } = seed();
    // Break the query string on purpose: visibility must not rest on it.
    const filter = pb.filter.bind(pb);
    vi.spyOn(pb, 'filter').mockImplementation((expr, params) =>
      expr.startsWith('(shared') ? 'kind != "none"' : filter(expr, params),
    );
    const ids = (await findTabs(pb, BOB, { title: 'Master of Puppets', artist: 'Metallica' })).map((r) => r.id);
    expect(ids).not.toContain('a-private');
  });
});

describe('migration of rows from before the store', () => {
  it('backfillPatch fills song_key, kind and format but never touches shared', () => {
    const old = row({ id: 'old', user: 'alice', title: 'Legacy Riff (Remastered)', artist: 'Old Artist', file: 'x.GP5', shared: false });
    expect(backfillPatch(old)).toEqual({ song_key: 'legacy riff::::old artist', kind: 'file', format: 'gp5' });
    expect(backfillPatch(row({ song_key: 'a::b', kind: 'file', format: 'gp5' }))).toBeNull();
  });

  it('old rows stay private to their uploader after the backfill', async () => {
    const { pb, rows } = fakePocketBase({
      tabs: [{ id: 'old', user: 'alice', title: 'Legacy Riff', artist: 'Old Artist', file: 'x.gp5', song_key: '', kind: '', format: '', shared: false }],
    });
    await backfillTabRows(pb);
    expect(rows.get('tabs')![0]).toMatchObject({ song_key: 'legacy riff::::old artist', kind: 'file', format: 'gp5', shared: false });
    expect(await findTabs(pb, BOB, { title: 'Legacy Riff', artist: 'Old Artist' })).toEqual([]);
    expect((await findTabs(pb, ALICE, { title: 'Legacy Riff', artist: 'Old Artist' })).map((r) => r.id)).toEqual(['old']);
  });

  it('a keyless row written after the one-time pass is still found, and filled in then', async () => {
    const { pb, rows } = fakePocketBase({ tabs: [] });
    await backfillTabRows(pb);
    rows.get('tabs')!.push({ id: 'late', collectionId: 'tabs', collectionName: 'tabs', created: '', user: 'alice', title: 'Late Riff', artist: 'Band', file: 'l.gp4', song_key: '', kind: '', format: '', shared: false });
    expect((await findTabs(pb, ALICE, { title: 'Late Riff (Live)', artist: 'Band' })).map((r) => r.id)).toEqual(['late']);
    expect(rows.get('tabs')![0]).toMatchObject({ song_key: 'late riff::::band', kind: 'file', format: 'gp4', shared: false });
    expect(await findTabs(pb, BOB, { title: 'Late Riff', artist: 'Band' })).toEqual([]);
  });

  it('backfills once per process', async () => {
    const { pb, calls } = fakePocketBase({ tabs: [] });
    await backfillTabRows(pb);
    await backfillTabRows(pb);
    expect(calls.filter((c) => c.op === 'getFullList')).toHaveLength(1);
  });
});

describe('Songsterr hints', () => {
  it('searches once, stores the hints on the song rows, then answers from them', async () => {
    const { pb, rows } = fakePocketBase({
      tabs: [{ id: 't', user: 'alice', shared: true, kind: 'file', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica' }],
    });
    const search = vi.fn().mockResolvedValue([SONG]);

    expect(await hintsFor(pb, 'Master of Puppets', 'Metallica', search)).toEqual([SONG]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(rows.get('tabs')![0].hints).toMatchObject({ source: 'songsterr', songs: [SONG] });

    expect(await hintsFor(pb, 'Master of Puppets (Live)', 'Metallica', search)).toEqual([SONG]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps tuning per instrument in the stored hints', async () => {
    const { pb, rows } = fakePocketBase({
      tabs: [{ id: 't', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica' }],
    });
    await hintsFor(pb, 'Master of Puppets', 'Metallica', vi.fn().mockResolvedValue([SONG]));
    const stored = rows.get('tabs')![0].hints as { songs: SongsterrSongHint[] };
    expect(stored.songs[0].tracks[0]).toEqual({ instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 40], difficulty: 3 });
  });

  it('does not store anything when Songsterr could not be asked', async () => {
    const { pb, rows } = fakePocketBase({
      tabs: [{ id: 't', title: 'One', artist: 'Metallica', song_key: 'one::::metallica' }],
    });
    expect(await hintsFor(pb, 'One', 'Metallica', vi.fn().mockResolvedValue(null))).toBeNull();
    expect(rows.get('tabs')![0].hints).toBeUndefined();
  });

  it('a song with no tab rows still gets an answer, just not a stored one', async () => {
    const { pb } = fakePocketBase({ tabs: [] });
    const search = vi.fn().mockResolvedValue([SONG]);
    expect(await hintsFor(pb, 'Master of Puppets', 'Metallica', search)).toEqual([SONG]);
  });
});

describe('recordGenerated', () => {
  it('creates one shared generated row per track, with hints', async () => {
    const { pb, rows } = fakePocketBase({ tabs: [] });
    const search = vi.fn().mockResolvedValue([SONG]);
    const g = { trackId: 'youtube:abc', title: 'Master of Puppets', artist: 'Metallica', userId: 'alice', file: 'youtube-abc.alphatex' };

    const first = await recordGenerated(pb, g, search);
    const again = await recordGenerated(pb, { ...g, userId: 'bob' }, search);

    expect(again.id).toBe(first.id);
    expect(rows.get('tabs')).toHaveLength(1);
    expect(rows.get('tabs')![0]).toMatchObject({
      kind: 'generated',
      format: 'alphatex',
      shared: true,
      user: 'alice',
      track_key: 'youtube:abc',
      song_key: 'master of puppets::::metallica',
    });
    expect(rows.get('tabs')![0].hints).toMatchObject({ songs: [SONG] });
  });

  it('is found by song afterwards, by anyone', async () => {
    const { pb } = fakePocketBase({ tabs: [] });
    await recordGenerated(
      pb,
      { trackId: 'upload:u1', title: 'Riff', artist: 'Me', userId: null, file: 'upload-u1.alphatex' },
      vi.fn().mockResolvedValue(null),
    );
    const found = await findTabs(pb, BOB, { title: 'Riff', artist: 'Me' });
    expect(found.map((r) => mapTab(r, BOB))).toMatchObject([{ kind: 'generated', canDelete: false }]);
  });
});

describe('deleting a member (bughunt X10)', () => {
  it('removes only their private tabs; shared ones and other people’s stay', async () => {
    const { pb, rows } = fakePocketBase({
      tabs: [
        { id: 'mine-private', user: 'alice', shared: false, kind: 'file', file: 'a.gp5' },
        { id: 'mine-shared', user: 'alice', shared: true, kind: 'file', file: 'b.gp5' },
        { id: 'bobs-private', user: 'bob', shared: false, kind: 'file', file: 'c.gp5' },
      ],
    });
    expect(await deletePrivateTabs(pb, 'alice')).toBe(1);
    expect(rows.get('tabs')!.map((r) => r.id)).toEqual(['mine-shared', 'bobs-private']);
  });
});
