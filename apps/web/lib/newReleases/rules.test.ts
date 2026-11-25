import { describe, expect, it } from 'vitest';
import {
  applyRun,
  buildWatchlist,
  emptyLedger,
  genreWatchlist,
  isNew,
  likedArtists,
  memberFamilies,
  pickDue,
  selectForMember,
  type LikeRow,
  type LikedArtist,
  type Ledger,
  type NewReleasesAnswer,
  type Release,
} from './rules';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const id = (n: number) => `UC${String(n).padStart(8, '0')}`;

const like = (over: Partial<LikeRow>): LikeRow => ({
  source: 'youtube',
  artistId: id(1),
  artist: 'Artist',
  likedAt: '2026-01-01T00:00:00.000Z',
  created: '2026-01-01T00:00:00.000Z',
  ...over,
});

const la = (n: number, count: number, at = '2026-01-01T00:00:00.000Z'): LikedArtist => ({
  artistId: id(n),
  name: `A${n}`,
  count,
  lastLikedAt: at,
});

const answer = (over: Partial<NewReleasesAnswer> = {}): NewReleasesAnswer => ({ artists: [], explore: null, failed: [], ...over });
const rel = (browseId: string, year: number | null = 2026, type = 'Single') => ({ browseId, title: `T ${browseId}`, year, type, artworkUrl: null });
const artistAns = (artistId: string, releases: ReturnType<typeof rel>[], name = 'Name') => ({ id: artistId, name, releases });

const NOV = Date.UTC(2026, 10, 22);
const JAN20 = Date.UTC(2027, 0, 20);

const entry = (checkedAt: string, known: string[] = [], scannedAt: string | null = checkedAt) => ({ name: 'N', checkedAt, scannedAt, known });
const ledgerWith = (over: Partial<Ledger>): Ledger => ({ ...emptyLedger(), ...over });
const release = (browseId: string, firstSeenAt: string, over: Partial<Release> = {}): Release => ({
  browseId,
  title: 't',
  kind: 'single',
  year: 2026,
  artworkUrl: null,
  artist: 'Art',
  artistId: id(1),
  family: 'pop',
  firstSeenAt,
  via: 'artist',
  ...over,
});

describe('likedArtists', () => {
  it('groups by artistId, counts, takes the latest like date and the lead artist name', () => {
    const out = likedArtists([
      like({ artist: 'Old Name', likedAt: '2026-01-01T00:00:00.000Z' }),
      like({ artist: 'Dua Lipa feat. DaBaby', likedAt: '2026-03-01T00:00:00.000Z' }),
      like({ artist: 'Older', likedAt: '2025-01-01T00:00:00.000Z' }),
      like({ artistId: id(2), artist: 'Other', likedAt: null, created: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(out).toEqual([
      { artistId: id(1), name: 'Dua Lipa', count: 3, lastLikedAt: '2026-03-01T00:00:00.000Z' },
      { artistId: id(2), name: 'Other', count: 1, lastLikedAt: '2026-02-01T00:00:00.000Z' },
    ]);
  });

  it('ignores uploads, Jamendo and missing or malformed ids', () => {
    const out = likedArtists([
      like({ source: 'upload' }),
      like({ source: 'jamendo' }),
      like({ artistId: null }),
      like({ artistId: 'short' }),
      like({ artistId: 'bad id with spaces!' }),
      like({ artistId: id(9) }),
    ]);
    expect(out.map((a) => a.artistId)).toEqual([id(9)]);
  });
});

describe('buildWatchlist', () => {
  it('takes members in turn and never an artist twice', () => {
    const out = buildWatchlist([
      { id: 'b', artists: [la(1, 5), la(3, 1)] },
      { id: 'a', artists: [la(1, 9), la(2, 2)] },
    ]);
    // a first (id order): 1, then b: 1 is taken so 3, then a: 2.
    expect(out).toEqual([id(1), id(3), id(2)]);
  });

  it('stops at 60', () => {
    const artists = Array.from({ length: 100 }, (_, i) => la(i + 1, 100 - i));
    expect(buildWatchlist([{ id: 'a', artists }])).toHaveLength(60);
    const many = Array.from({ length: 80 }, (_, m) => ({ id: `m${m}`, artists: [la(1000 + m, 1)] }));
    expect(buildWatchlist(many)).toHaveLength(60);
  });

  it('gives the same order for the same input', () => {
    const members = [
      { id: 'b', artists: [la(1, 1, '2026-01-02T00:00:00.000Z'), la(2, 1, '2026-01-03T00:00:00.000Z')] },
      { id: 'a', artists: [la(3, 1), la(4, 1)] },
    ];
    const first = buildWatchlist(members);
    expect(buildWatchlist([...members].reverse())).toEqual(first);
    expect(buildWatchlist(members)).toEqual(first);
  });
});

describe('genreWatchlist', () => {
  const chart = (slug: string, ids: (string | null)[]) => ({ slug, tracks: ids.map((artistId) => ({ artistId })) });

  it('uses only the charts of the wanted families', () => {
    const out = genreWatchlist([chart('pop', [id(1)]), chart('latin', [id(2)]), chart('jazz', [id(3)])], ['pop', 'jazz-blues'], []);
    expect(out.sort()).toEqual([id(1), id(3)]);
  });

  it('takes 8 distinct artists per chart by rank, skipping missing ids and liked artists', () => {
    const ids = [id(1), id(1), null, id(2), id(3), id(4), id(5), id(6), id(7), id(8), id(9), id(10), id(11)];
    const out = genreWatchlist([chart('pop', ids)], ['pop'], new Set([id(2)]));
    expect(out).toEqual([id(1), id(3), id(4), id(5), id(6), id(7), id(8), id(9)]);
  });

  it('stops at 30', () => {
    const charts = Array.from({ length: 4 }, (_, c) =>
      chart(['pop', 'hip-hop', 'rock', 'latin'][c], Array.from({ length: 8 }, (_, i) => id(c * 100 + i + 1))),
    );
    expect(genreWatchlist(charts, ['pop', 'hiphop-rnb', 'rock-metal', 'latin'], [])).toHaveLength(30);
    const wide = Array.from({ length: 6 }, (_, c) => chart('rock', Array.from({ length: 8 }, (_, i) => id(c * 100 + i + 1))));
    expect(genreWatchlist(wide, ['rock-metal'], [], 5)).toHaveLength(5);
  });
});

describe('pickDue', () => {
  const liked = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
  const genre = (n: number) => Array.from({ length: n }, (_, i) => id(i + 500));

  it('puts never-checked first, then the oldest checkedAt', () => {
    const artists = {
      [id(1)]: entry('2026-11-10T00:00:00.000Z'),
      [id(2)]: entry('2026-11-01T00:00:00.000Z'),
      [id(4)]: entry('2026-11-05T00:00:00.000Z'),
    };
    expect(pickDue(artists, [id(1), id(2), id(3), id(4)], [])).toEqual([id(3), id(2), id(4), id(1)]);
  });

  it('takes 12 liked and 6 genre', () => {
    const out = pickDue({}, liked(40), genre(20));
    expect(out).toHaveLength(18);
    expect(out.filter((x) => Number(x.slice(2)) < 500)).toHaveLength(12);
    expect(out.filter((x) => Number(x.slice(2)) >= 500)).toHaveLength(6);
  });

  it('gives the spare of a short list to the other', () => {
    expect(pickDue({}, liked(40), genre(2))).toHaveLength(18);
    expect(pickDue({}, liked(40), genre(2)).filter((x) => Number(x.slice(2)) < 500)).toHaveLength(16);
    expect(pickDue({}, liked(3), genre(40)).filter((x) => Number(x.slice(2)) >= 500)).toHaveLength(15);
  });

  it('never returns more than 18', () => {
    expect(pickDue({}, liked(60), genre(30)).length).toBeLessThanOrEqual(18);
    expect(pickDue({}, liked(60), []).length).toBe(18);
    expect(pickDue({}, [], genre(30)).length).toBe(18);
  });
});

describe('applyRun, baseline', () => {
  it('a first scan in November marks nothing new and records every id', () => {
    const out = applyRun(emptyLedger(), answer({ artists: [artistAns(id(1), [rel('a'), rel('b', 2026), rel('c', 2019, 'Album')])] }), NOV);
    expect(out.releases).toEqual([]);
    expect(out.artists[id(1)].known).toEqual(['a', 'b', 'c']);
    expect(out.artists[id(1)].scannedAt).toBe(iso(NOV));
  });

  it('a first scan on 20 January marks a release of that year new, dated 1 January', () => {
    const out = applyRun(emptyLedger(), answer({ artists: [artistAns(id(1), [rel('a', 2027), rel('b', 2026)])] }), JAN20);
    expect(out.releases.map((r) => [r.browseId, r.firstSeenAt])).toEqual([['a', '2027-01-01T00:00:00.000Z']]);
    expect(out.artists[id(1)].known).toEqual(['a', 'b']);
  });
});

describe('applyRun, later scans', () => {
  const base = ledgerWith({ artists: { [id(1)]: entry('2026-11-01T00:00:00.000Z', ['old']) } });

  it('a new id of this year is new at the run time', () => {
    const out = applyRun(base, answer({ artists: [artistAns(id(1), [rel('n', 2026), rel('old')])] }), NOV);
    expect(out.releases).toHaveLength(1);
    expect(out.releases[0]).toMatchObject({ browseId: 'n', firstSeenAt: iso(NOV), via: 'artist', artistId: id(1) });
  });

  it('a new id with an old year is recorded and not new', () => {
    const out = applyRun(base, answer({ artists: [artistAns(id(1), [rel('re', 2019, 'Album')])] }), NOV);
    expect(out.releases).toEqual([]);
    expect(out.artists[id(1)].known).toContain('re');
  });

  it('a 2026 release seen in January 2027 passes the year gate', () => {
    const out = applyRun(base, answer({ artists: [artistAns(id(1), [rel('dec', 2026)])] }), JAN20);
    expect(out.releases.map((r) => r.browseId)).toEqual(['dec']);
  });

  it('a new id with no year is new', () => {
    const out = applyRun(base, answer({ artists: [artistAns(id(1), [rel('noyear', null)])] }), NOV);
    expect(out.releases.map((r) => r.browseId)).toEqual(['noyear']);
  });

  it('an id already known changes nothing', () => {
    const out = applyRun(base, answer({ artists: [artistAns(id(1), [rel('old')])] }), NOV);
    expect(out.releases).toEqual([]);
    expect(out.artists[id(1)].known).toEqual(['old']);
  });
});

describe('applyRun, explore', () => {
  const item = (browseId: string, artistId: string | null = id(5), artist = 'Shelf Artist') => ({
    browseId,
    title: 'S',
    type: 'Single',
    artist,
    artistId,
    artworkUrl: null,
  });

  it('a shelf item is new once', () => {
    const first = applyRun(emptyLedger(), answer({ explore: [item('x')] }), NOV);
    expect(first.releases.map((r) => [r.browseId, r.via])).toEqual([['x', 'explore']]);
    const again = applyRun(first, answer({ explore: [item('x')] }), NOV + 2 * DAY);
    expect(again.releases).toHaveLength(1);
    expect(again.releases[0].firstSeenAt).toBe(iso(NOV));
  });

  it('the same release from a scan and from the shelf is one release with the earlier date', () => {
    const base = ledgerWith({ artists: { [id(5)]: entry('2026-11-01T00:00:00.000Z', []) } });
    const viaScan = applyRun(base, answer({ artists: [artistAns(id(5), [rel('x')])] }), NOV);
    const both = applyRun(viaScan, answer({ explore: [item('x')] }), NOV + 3 * DAY);
    expect(both.releases).toHaveLength(1);
    expect(both.releases[0].firstSeenAt).toBe(iso(NOV));
    const shelfFirst = applyRun(emptyLedger(), answer({ explore: [item('y')] }), NOV);
    const later = applyRun(shelfFirst, answer({ artists: [artistAns(id(5), [rel('y')])] }), NOV + 3 * DAY);
    expect(later.releases).toHaveLength(1);
    expect(later.releases[0].firstSeenAt).toBe(iso(NOV));
  });

  it('a shelf item by an artist still at baseline is new', () => {
    const out = applyRun(emptyLedger(), answer({ artists: [artistAns(id(5), [rel('x', 2026)])], explore: [item('x')] }), NOV);
    expect(out.releases.map((r) => r.browseId)).toEqual(['x']);
  });

  it('an item with no artist is dropped', () => {
    const out = applyRun(emptyLedger(), answer({ explore: [item('x', null, ''), item('y', null, '  ')] }), NOV);
    expect(out.releases).toEqual([]);
  });
});

describe('applyRun, upkeep', () => {
  it('a failed artist keeps known and gets a newer checkedAt', () => {
    const base = ledgerWith({ artists: { [id(1)]: entry('2026-11-01T00:00:00.000Z', ['a', 'b']) } });
    const out = applyRun(base, answer({ failed: [id(1), id(2)] }), NOV);
    expect(out.artists[id(1)]).toMatchObject({ known: ['a', 'b'], checkedAt: iso(NOV), scannedAt: '2026-11-01T00:00:00.000Z' });
    // A dead channel never seen before still moves on, and its next success is a baseline.
    expect(out.artists[id(2)]).toMatchObject({ known: [], checkedAt: iso(NOV), scannedAt: null });
  });

  it('a release past 42 days moves to retired and cannot return from either source', () => {
    const old = release('gone', iso(NOV - 43 * DAY), { artistId: id(1) });
    const base = ledgerWith({ releases: [old], artists: { [id(1)]: entry('2026-11-01T00:00:00.000Z', []) } });
    const out = applyRun(
      base,
      answer({
        artists: [artistAns(id(1), [rel('gone')])],
        explore: [{ browseId: 'gone', title: 't', type: 'Single', artist: 'Art', artistId: id(1), artworkUrl: null }],
      }),
      NOV,
    );
    expect(out.releases).toEqual([]);
    expect(out.retired).toContain('gone');
  });

  it('known stops at 60 and retired at 500', () => {
    const page = Array.from({ length: 80 }, (_, i) => rel(`k${i}`, 2019, 'Album'));
    const out = applyRun(emptyLedger(), answer({ artists: [artistAns(id(1), page)] }), NOV);
    expect(out.artists[id(1)].known).toHaveLength(60);
    expect(out.artists[id(1)].known[0]).toBe('k0');
    const aged = Array.from({ length: 520 }, (_, i) => release(`r${i}`, iso(NOV - 50 * DAY)));
    const out2 = applyRun(ledgerWith({ releases: aged }), answer(), NOV);
    expect(out2.retired).toHaveLength(500);
    expect(out2.retired[499]).toBe('r519');
  });

  it('an artist off every watchlist is dropped after 30 days, not before', () => {
    const base = ledgerWith({
      artists: {
        [id(1)]: entry(iso(NOV - 31 * DAY), ['a']),
        [id(2)]: entry(iso(NOV - 29 * DAY), ['a']),
        [id(3)]: entry(iso(NOV - 90 * DAY), ['a']),
      },
    });
    const out = applyRun(base, answer(), NOV, [id(3)]);
    expect(Object.keys(out.artists).sort()).toEqual([id(2), id(3)]);
  });
});

describe('isNew', () => {
  it('is new at 41 days 23 hours and not at 42 days', () => {
    expect(isNew(iso(NOV - (42 * DAY - HOUR)), NOV)).toBe(true);
    expect(isNew(iso(NOV - 42 * DAY), NOV)).toBe(false);
  });
});

describe('memberFamilies', () => {
  const fams = (map: Record<number, 'pop' | 'latin' | 'balkan' | 'rock-metal' | null>) => (a: LikedArtist) => map[Number(a.artistId.slice(2))] ?? null;

  it('takes the top 3 by liked songs', () => {
    const liked = [la(1, 10), la(2, 8), la(3, 6), la(4, 5)];
    expect(memberFamilies(liked, fams({ 1: 'pop', 2: 'latin', 3: 'balkan', 4: 'rock-metal' }))).toEqual(['pop', 'latin', 'balkan']);
  });

  it('leaves out a family under 10% of the tagged total', () => {
    const liked = [la(1, 50), la(2, 45), la(3, 4)];
    expect(memberFamilies(liked, fams({ 1: 'pop', 2: 'latin', 3: 'balkan' }))).toEqual(['pop', 'latin']);
  });

  it('ignores untagged artists', () => {
    const liked = [la(1, 100), la(2, 3), la(3, 3)];
    expect(memberFamilies(liked, fams({ 1: null, 2: 'pop', 3: 'latin' })).sort()).toEqual(['latin', 'pop']);
  });

  it('gives none when nothing is tagged', () => {
    expect(memberFamilies([la(1, 5)], () => null)).toEqual([]);
    expect(memberFamilies([], () => 'pop')).toEqual([]);
  });
});

describe('selectForMember', () => {
  const at = (days: number) => iso(NOV - days * DAY);
  const liked = [la(1, 5), la(2, 9)];

  it('puts liked first, then similar, each flagged', () => {
    const out = selectForMember(
      [release('s', at(1), { artistId: id(7), family: 'pop' }), release('m', at(5), { artistId: id(1) })],
      liked,
      ['pop'],
      NOV,
    );
    expect(out.map((r) => [r.browseId, r.from])).toEqual([['m', 'liked'], ['s', 'similar']]);
  });

  it('never makes a liked artist release also a suggestion', () => {
    const out = selectForMember([release('m', at(1), { artistId: id(1), family: 'pop' })], liked, ['pop'], NOV);
    expect(out.map((r) => r.from)).toEqual(['liked']);
  });

  it('needs a matching family and a non-liked artist for a suggestion', () => {
    const out = selectForMember(
      [release('a', at(1), { artistId: id(7), family: 'latin' }), release('b', at(1), { artistId: id(8), family: 'pop' })],
      liked,
      ['pop'],
      NOV,
    );
    expect(out.map((r) => r.browseId)).toEqual(['b']);
  });

  it('suggests nothing for a release with no family', () => {
    expect(selectForMember([release('a', at(1), { artistId: id(7), family: null })], liked, ['pop'], NOV)).toEqual([]);
  });

  it('allows 2 per liked artist and 1 per suggested artist', () => {
    const out = selectForMember(
      [
        release('m1', at(1), { artistId: id(1) }),
        release('m2', at(2), { artistId: id(1) }),
        release('m3', at(3), { artistId: id(1) }),
        release('s1', at(1), { artistId: id(7) }),
        release('s2', at(2), { artistId: id(7) }),
      ],
      liked,
      ['pop'],
      NOV,
    );
    expect(out.map((r) => r.browseId)).toEqual(['m1', 'm2', 's1']);
  });

  it('caps liked at 12 and similar at 8', () => {
    const many = Array.from({ length: 30 }, (_, i) => la(100 + i, 1));
    const rels = [
      ...many.map((a, i) => release(`m${i}`, at(1 + i % 5), { artistId: a.artistId })),
      ...Array.from({ length: 20 }, (_, i) => release(`s${i}`, at(1 + i % 5), { artistId: id(300 + i) })),
    ];
    const out = selectForMember(rels, many, ['pop'], NOV);
    expect(out.filter((r) => r.from === 'liked')).toHaveLength(12);
    expect(out.filter((r) => r.from === 'similar')).toHaveLength(8);
  });

  it('orders newest first, ties by the artist liked count', () => {
    const out = selectForMember(
      [
        release('old', at(9), { artistId: id(2) }),
        release('tieLow', at(3), { artistId: id(1) }),
        release('tieHigh', at(3), { artistId: id(2) }),
        release('newest', at(1), { artistId: id(1) }),
      ],
      liked,
      [],
      NOV,
    );
    expect(out.map((r) => r.browseId)).toEqual(['newest', 'tieHigh', 'tieLow', 'old']);
  });

  it('gives nothing out for nothing in, and skips releases past the window', () => {
    expect(selectForMember([], liked, ['pop'], NOV)).toEqual([]);
    expect(selectForMember([release('x', at(50), { artistId: id(1) })], liked, ['pop'], NOV)).toEqual([]);
  });
});
