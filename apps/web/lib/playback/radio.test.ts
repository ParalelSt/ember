import { describe, expect, it } from 'vitest';
import { rankRadioPool, type RankRadioInput } from './radio';
import { exclusionKeys } from '../trackIdentity';
import type { Track } from '../../types/track';

function track(id: string, over: Partial<Track> = {}): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: over.title ?? `Title ${id}`,
    artist: over.artist ?? `Artist ${id}`,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 180,
    artworkUrl: null,
    streamUrl: `/stream/${id}`,
    ...over,
  };
}

const seed = track('seed', { title: 'Seed Song', artist: 'Seed Artist' });

function rank(over: Partial<RankRadioInput> = {}): Track[] {
  return rankRadioPool({
    pool: [],
    queue: [seed],
    current: seed,
    history: [],
    liked: [],
    context: null,
    ...over,
  });
}

const ids = (list: Track[]) => list.map((t) => t.id);

describe('rankRadioPool: variant blocking', () => {
  it('returns nothing for an empty pool', () => {
    expect(rank({ pool: [] })).toEqual([]);
  });

  it('drops the seed track by id', () => {
    expect(ids(rank({ pool: [seed, track('a')] }))).toEqual(['a']);
  });

  it('drops another VERSION of the seed track', () => {
    // songKey() collapses "(Official Video)" and friends onto the same song.
    const variant = track('seed-video', { title: 'Seed Song (Official Video)', artist: 'Seed Artist' });
    expect(ids(rank({ pool: [variant, track('a')] }))).toEqual(['a']);
  });

  it('drops tracks already in the queue, by id', () => {
    const queued = track('q1');
    expect(ids(rank({ queue: [seed, queued], pool: [queued, track('a')] }))).toEqual(['a']);
  });

  it('drops variants of tracks already in the queue', () => {
    const queued = track('q1', { title: 'Other Song', artist: 'Band' });
    const variant = track('q1-live', { title: 'Other Song [Lyrics]', artist: 'Band' });
    expect(ids(rank({ queue: [seed, queued], pool: [variant, track('a')] }))).toEqual(['a']);
  });

  it('keeps only the first of several variants inside the pool itself', () => {
    const first = track('p1', { title: 'New Song', artist: 'Band' });
    const dupe = track('p2', { title: 'New Song (Official Audio)', artist: 'Band' });
    expect(ids(rank({ pool: [first, dupe, track('a')] }))).toEqual(['p1', 'a']);
  });

  it('does not block on history or likes: those only rank', () => {
    const t = track('a');
    expect(ids(rank({ pool: [t], history: [t], liked: [t] }))).toEqual(['a']);
  });
});

describe('rankRadioPool: artist drift', () => {
  const byTarget = track('same', { artist: 'Target Artist' });
  const byOther = track('other', { artist: 'Someone Else' });

  it('filters out the context artist so the queue drifts elsewhere', () => {
    const out = rank({
      pool: [byTarget, byOther],
      context: { type: 'artist', artistName: 'Target Artist' },
    });
    expect(ids(out)).toEqual(['other']);
  });

  it('compares the artist case-insensitively', () => {
    const out = rank({
      pool: [track('same', { artist: 'TARGET artist' }), byOther],
      context: { type: 'artist', artistName: 'target ARTIST' },
    });
    expect(ids(out)).toEqual(['other']);
  });

  it('leaves the pool alone for an artist context with no name', () => {
    const out = rank({
      pool: [byTarget, byOther],
      context: { type: 'artist', artistName: '' },
    });
    expect(ids(out)).toEqual(['same', 'other']);
  });

  it('leaves the pool alone for every other context', () => {
    const out = rank({
      pool: [byTarget, byOther],
      context: { type: 'playlist', playlistId: 'p', playlistName: 'Mix' },
    });
    expect(ids(out)).toEqual(['same', 'other']);
  });
});

describe('rankRadioPool: known ranking', () => {
  it('sorts played tracks by personal play count, descending', () => {
    const a = track('a');
    const b = track('b');
    const c = track('c');
    // b played 3 times, c twice, a once.
    const history = [a, b, b, b, c, c];
    expect(ids(rank({ pool: [a, b, c], history }))).toEqual(['b', 'c', 'a']);
  });

  it('breaks a play-count tie with the liked list', () => {
    const a = track('a');
    const b = track('b');
    const out = rank({ pool: [a, b], history: [a, b], liked: [b] });
    expect(ids(out)).toEqual(['b', 'a']);
  });

  it('keeps the API order for tracks that were never played', () => {
    expect(ids(rank({ pool: [track('a'), track('b'), track('c')] }))).toEqual(['a', 'b', 'c']);
  });
});

describe('rankRadioPool: front load and weave', () => {
  const known = ['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => track(id));
  const fresh = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => track(id));
  // Descending play counts keep the known order k1..k5 stable.
  const history = known.flatMap((t, i) => Array<Track>(known.length - i).fill(t));

  it('front-loads two known tracks, then weaves one known per three slots', () => {
    const out = rank({ pool: [...fresh, ...known], history });
    expect(ids(out)).toEqual(['k1', 'k2', 'f1', 'k3', 'f2', 'f3', 'k4', 'f4', 'f5', 'k5']);
  });

  it('puts the known tracks at positions 0, 1, 3, 6 and 9', () => {
    const out = rank({ pool: [...fresh, ...known], history });
    const knownAt = out.map((t, i) => (t.id.startsWith('k') ? i : -1)).filter((i) => i >= 0);
    expect(knownAt).toEqual([0, 1, 3, 6, 9]);
  });

  it('front-loads only what it has when fewer than two tracks are known', () => {
    const out = rank({ pool: [...fresh, known[0]], history: [known[0]] });
    expect(ids(out)).toEqual(['k1', 'f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('appends the remaining known tracks once the fresh ones run out', () => {
    const out = rank({ pool: known.slice(0, 3), history });
    expect(ids(out)).toEqual(['k1', 'k2', 'k3']);
  });

  it('returns every fresh track in order when nothing is known', () => {
    expect(ids(rank({ pool: fresh }))).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('loses nothing: every surviving candidate appears exactly once', () => {
    const out = rank({ pool: [...fresh, ...known], history });
    expect(out).toHaveLength(known.length + fresh.length);
    expect(new Set(ids(out)).size).toBe(out.length);
  });
});

describe('rankRadioPool: songs a played-from list already has', () => {
  // A recommendation tapped under a playlist plays alone, then radio carries
  // on from it. What the playlist already has must not come back (bug
  // report 2026-10-02: "the next one in queue was a song already in the
  // playlist").
  const inPlaylist = track('youtube:pl1', { sourceId: 'pl1', title: 'Already Here', artist: 'Band' });
  const exclude = exclusionKeys([inPlaylist]);

  it('drops a song the playlist already has', () => {
    const out = rank({ pool: [inPlaylist, track('a')], context: { type: 'single', exclude } });
    expect(ids(out)).toEqual(['a']);
  });

  it('drops it whatever spelling its id comes back in', () => {
    const doubled = track('youtube:youtube:pl1', { sourceId: 'pl1', title: 'Already Here', artist: 'Band' });
    expect(ids(rank({ pool: [doubled, track('a')], context: { type: 'single', exclude } }))).toEqual(['a']);
  });

  it('drops another version of it', () => {
    const video = track('youtube:pl1-video', { sourceId: 'pl1-video', title: 'Already Here (Official Video)', artist: 'Band' });
    expect(ids(rank({ pool: [video, track('a')], context: { type: 'single', exclude } }))).toEqual(['a']);
  });

  it('keeps everything without an exclude list', () => {
    expect(ids(rank({ pool: [inPlaylist, track('a')], context: { type: 'single' } }))).toEqual(['youtube:pl1', 'a']);
  });

  it('ignores a malformed persisted exclude list', () => {
    const context = { type: 'single', exclude: 'nope' } as unknown as RankRadioInput['context'];
    expect(ids(rank({ pool: [inPlaylist, track('a')], context }))).toEqual(['youtube:pl1', 'a']);
  });

  it('drops a queued song whose id is spelled with a doubled prefix', () => {
    const queued = track('youtube:q9', { sourceId: 'q9', title: 'Queued', artist: 'Q' });
    const doubled = { ...queued, id: 'youtube:youtube:q9' };
    expect(ids(rank({ queue: [seed, queued], pool: [doubled, track('a')] }))).toEqual(['a']);
  });
});
