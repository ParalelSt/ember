import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// parseNewReleases reads `player.py new-releases`; fetchNewReleases spawns it.
// The spawn is faked, so nothing here reaches YouTube.

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let lastSpawnArgs: string[] | undefined;
let nextStdout = '{}';
const spawn = vi.fn((_cmd: string, args: string[]) => {
  lastSpawnArgs = args;
  const child = new FakeChild();
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(nextStdout));
    child.emit('close', 0);
  });
  return child;
});
vi.mock('node:child_process', () => ({ spawn, default: { spawn } }));

const ID = 'UCabcdefgh12345';
const rel = (over: Record<string, unknown> = {}) => ({
  browseId: 'MPREb_release001',
  title: 'A title',
  year: '2026',
  type: 'Album',
  artworkUrl: 'https://img/x',
  ...over,
});

describe('parseNewReleases', () => {
  it('drops artists with a bad id and releases with a bad browseId', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const out = parseNewReleases({
      artists: [
        { id: 'short', name: 'Bad', releases: [rel()] },
        { id: 'has space in it', name: 'Bad', releases: [rel()] },
        { id: ID, name: 'Good', releases: [rel(), rel({ browseId: 'no spaces allowed' }), rel({ browseId: '' }), rel({ browseId: undefined }), rel({ browseId: 'MPREb_x', title: '  ' })] },
      ],
    });
    expect(out.artists.map((a) => a.id)).toEqual([ID]);
    expect(out.artists[0].releases.map((r) => r.browseId)).toEqual(['MPREb_release001']);
  });

  it('normalises kind, falling back to the shelf the item came from', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const out = parseNewReleases({
      artists: [{
        id: ID,
        name: 'A',
        releases: [
          rel({ browseId: 'MPREb_a00001', type: 'Album' }),
          rel({ browseId: 'MPREb_e00001', type: 'EP' }),
          rel({ browseId: 'MPREb_s00001', type: 'Single' }),
          rel({ browseId: 'MPREb_l00001', type: 'ep' }),
          rel({ browseId: 'MPREb_o00001', type: 'Mixtape' }),
          rel({ browseId: 'MPREb_n00001', type: null }),
        ],
      }],
      explore: [rel({ browseId: 'MPREb_x00001', type: 'Weird', artist: 'X', artistId: ID }), rel({ browseId: 'MPREb_x00002', type: 'Single', artist: 'X', artistId: ID })],
    });
    expect(out.artists[0].releases.map((r) => r.kind)).toEqual(['album', 'ep', 'single', 'ep', 'single', 'single']);
    expect(out.explore?.map((r) => r.kind)).toEqual(['album', 'single']);
  });

  it('turns the year into a number or null', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const years = ['2026', 2025, ' 2024 ', null, undefined, '', 'Unknown', '26', 20260, '2026-01'];
    const out = parseNewReleases({ artists: [{ id: ID, name: 'A', releases: years.map((year, i) => rel({ browseId: `MPREb_year${i}00`, year })) }] });
    expect(out.artists[0].releases.map((r) => r.year)).toEqual([2026, 2025, 2024, null, null, null, null, null, null, null]);
  });

  it('drops duplicate releases and duplicate artists, first one wins', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const out = parseNewReleases({
      artists: [
        { id: ID, name: 'First', releases: [rel({ title: 'One' }), rel({ title: 'Two' })] },
        { id: ID, name: 'Second', releases: [rel({ browseId: 'MPREb_other001' })] },
      ],
      explore: [rel({ title: 'One', artist: 'X' }), rel({ title: 'Two', artist: 'X' })],
    });
    expect(out.artists).toHaveLength(1);
    expect(out.artists[0].name).toBe('First');
    expect(out.artists[0].releases.map((r) => r.title)).toEqual(['One']);
    expect(out.explore?.map((r) => r.title)).toEqual(['One']);
  });

  it('reads a missing explore as null and an empty one as an empty list', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    expect(parseNewReleases({ artists: [] }).explore).toBeNull();
    expect(parseNewReleases({ artists: [], explore: null }).explore).toBeNull();
    expect(parseNewReleases({ artists: [], explore: [] }).explore).toEqual([]);
  });

  it('keeps explore artist names and drops an unusable artist id to null', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const out = parseNewReleases({ explore: [rel({ artist: 'Name', artistId: ID }), rel({ browseId: 'MPREb_two0001', artist: 'N2', artistId: 'x' }), rel({ browseId: 'MPREb_three01', artist: 'N3' })] });
    expect(out.explore?.map((r) => [r.artist, r.artistId])).toEqual([['Name', ID], ['N2', null], ['N3', null]]);
  });

  it('keeps `failed` to strings', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    expect(parseNewReleases({ failed: ['explore', ID, 3, null, { a: 1 }] }).failed).toEqual(['explore', ID]);
    expect(parseNewReleases({ failed: 'explore' }).failed).toEqual([]);
  });

  it('survives null, an empty object and junk entries', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const empty = { artists: [], explore: null, failed: [] };
    expect(parseNewReleases(null)).toEqual(empty);
    expect(parseNewReleases(undefined)).toEqual(empty);
    expect(parseNewReleases({})).toEqual(empty);
    // @ts-expect-error junk on purpose
    expect(parseNewReleases({ artists: [null, 3, 'x'], explore: [null, 7] }).artists).toEqual([]);
  });

  it('gives a missing artwork url null', async () => {
    const { parseNewReleases } = await import('../sources/youtube');
    const out = parseNewReleases({ artists: [{ id: ID, name: 'A', releases: [rel({ artworkUrl: null }), rel({ browseId: 'MPREb_blank01', artworkUrl: '' })] }] });
    expect(out.artists[0].releases.map((r) => r.artworkUrl)).toEqual([null, null]);
  });
});

describe('fetchNewReleases', () => {
  afterEach(() => {
    vi.clearAllMocks();
    lastSpawnArgs = undefined;
  });

  it('sends --artists=<list> and --explore, on valid unique ids only', async () => {
    nextStdout = JSON.stringify({ artists: [{ id: '-UCleading01', name: 'A', releases: [rel()] }], explore: [], failed: [] });
    const { fetchNewReleases } = await import('../sources/youtube');
    const out = await fetchNewReleases(['-UCleading01', ID, ID, 'bad id', 'x'], { explore: true });
    expect(lastSpawnArgs).toEqual([expect.stringContaining('player.py'), 'new-releases', `--artists=-UCleading01,${ID}`, '--explore']);
    expect(out.artists[0].releases).toHaveLength(1);
  });

  it('omits --explore when not asked for', async () => {
    nextStdout = '{"artists":[],"explore":null,"failed":[]}';
    const { fetchNewReleases } = await import('../sources/youtube');
    await fetchNewReleases([ID]);
    expect(lastSpawnArgs).toEqual([expect.stringContaining('player.py'), 'new-releases', `--artists=${ID}`]);
  });

  it('asks for the shelf alone with no artist ids', async () => {
    nextStdout = '{"artists":[],"explore":[],"failed":[]}';
    const { fetchNewReleases } = await import('../sources/youtube');
    await fetchNewReleases([], { explore: true });
    expect(lastSpawnArgs).toEqual([expect.stringContaining('player.py'), 'new-releases', '--explore']);
  });

  it('answers without spawning when there is nothing to ask', async () => {
    const { fetchNewReleases } = await import('../sources/youtube');
    expect(await fetchNewReleases([])).toEqual({ artists: [], explore: null, failed: [] });
    expect(await fetchNewReleases(['bad id'], { explore: false })).toEqual({ artists: [], explore: null, failed: [] });
    expect(spawn).not.toHaveBeenCalled();
  });
});
