import { describe, expect, it } from 'vitest';
import {
  addedMessage,
  carlistJoinPath,
  carlistJoinUrl,
  insertIndex,
  mergeIntoPlayerQueue,
  normalizeCode,
  parseAddPosition,
  parseJoinInput,
  personLabel,
  placeWords,
  planInsert,
  sessionIndexFor,
  songsAhead,
  whosePhone,
  estimateProgress,
} from './carlist';

describe('join codes and links', () => {
  it('cleans up a typed code', () => {
    expect(normalizeCode(' k7m-pq4 ')).toBe('K7MPQ4');
    expect(normalizeCode('abc')).toBeNull();
    expect(normalizeCode('K7MPQ4"||1=1')).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });

  it('builds the join link', () => {
    expect(carlistJoinPath('K7MPQ4')).toBe('/session/join/K7MPQ4');
    expect(carlistJoinUrl('https://ember.example/', 'K7MPQ4')).toBe('https://ember.example/session/join/K7MPQ4');
  });

  it('reads a code or a pasted link', () => {
    expect(parseJoinInput('k7mpq4')).toBe('K7MPQ4');
    expect(parseJoinInput('https://ember.example/session/join/K7MPQ4')).toBe('K7MPQ4');
    expect(parseJoinInput('http://192.168.1.20:3000/session/join/k7mpq4?x=1#y')).toBe('K7MPQ4');
    expect(parseJoinInput('Join my carlist: https://e.example/session/join/ABC234 see you')).toBe('ABC234');
    expect(parseJoinInput('/session/join/%4B7MPQ4')).toBe('K7MPQ4');
    expect(parseJoinInput('https://e.example/session/join/%E0%A4%A')).toBeNull();
    expect(parseJoinInput('https://e.example/playlist/join/abc')).toBeNull();
    expect(parseJoinInput('')).toBeNull();
  });
});

describe('add position', () => {
  it('parses the request field', () => {
    expect(parseAddPosition(undefined)).toBe('end');
    expect(parseAddPosition(null)).toBe('end');
    expect(parseAddPosition('next')).toBe('next');
    expect(parseAddPosition('end')).toBe('end');
    expect(parseAddPosition('first')).toBeNull();
    expect(parseAddPosition(1)).toBeNull();
    expect(parseAddPosition('NEXT')).toBeNull();
  });

  it('places next right after what is playing, end at the end', () => {
    expect(insertIndex(5, 1, 'next')).toBe(2);
    expect(insertIndex(5, 1, 'end')).toBe(5);
    expect(insertIndex(5, 4, 'next')).toBe(5);
    expect(insertIndex(0, 0, 'next')).toBe(0);
    expect(insertIndex(3, 9, 'next')).toBe(3);
    expect(insertIndex(3, -2, 'next')).toBe(1);
  });

  it('says where it landed', () => {
    expect(songsAhead(2, 1)).toBe(0);
    expect(songsAhead(5, 1)).toBe(3);
    expect(songsAhead(0, 0)).toBe(-1);
    expect(placeWords(-1)).toBe('up first');
    expect(placeWords(0)).toBe('plays next');
    expect(placeWords(1)).toBe('2nd in line');
    expect(placeWords(2)).toBe('3rd in line');
    expect(placeWords(3)).toBe('4th in line');
    expect(placeWords(10)).toBe('11th in line');
    expect(placeWords(20)).toBe('21st in line');
    expect(placeWords(111)).toBe('112th in line');
    expect(addedMessage('Dreams', 0)).toBe('Added "Dreams", plays next');
  });
});

describe('planInsert (server)', () => {
  it('appends at the end without moving anything', () => {
    expect(planInsert([1, 2, 3], 0, 'end')).toEqual({ at: 3, position: 4, shifts: [], ahead: 2 });
  });

  it('plays next: takes the slot after the current song and moves the rest down', () => {
    expect(planInsert([1, 2, 3, 4], 1, 'next')).toEqual({
      at: 2,
      position: 3,
      shifts: [
        { index: 2, position: 4 },
        { index: 3, position: 5 },
      ],
      ahead: 0,
    });
  });

  it('uses a gap when there is one', () => {
    expect(planInsert([1, 2, 10, 11], 1, 'next')).toEqual({ at: 2, position: 3, shifts: [], ahead: 0 });
    expect(planInsert([1, 2, 4, 5], 1, 'next').shifts).toEqual([]);
  });

  it('keeps positions strictly increasing even with ties', () => {
    const plan = planInsert([1, 2, 3, 3, 4], 1, 'next');
    const rows = [1, 2, 3, 3, 4];
    for (const s of plan.shifts) rows[s.index] = s.position;
    const final = [...rows.slice(0, plan.at), plan.position, ...rows.slice(plan.at)];
    for (let i = 1; i < final.length; i++) expect(final[i]).toBeGreaterThan(final[i - 1]);
  });

  it('play next on the last song or an empty queue is an append', () => {
    expect(planInsert([1, 2, 3], 2, 'next')).toEqual({ at: 3, position: 4, shifts: [], ahead: 0 });
    expect(planInsert([], 0, 'next')).toEqual({ at: 0, position: 1, shifts: [], ahead: -1 });
  });
});

const t = (id: string) => ({ id });
const ids = (q: { id: string }[]) => q.map((x) => x.id).join(',');

describe('mergeIntoPlayerQueue (host client)', () => {
  it('nothing missing: no change', () => {
    expect(mergeIntoPlayerQueue([t('a'), t('b')], 0, [t('a'), t('b')])).toBeNull();
  });

  it('an empty player takes the whole carlist and starts at the top', () => {
    const r = mergeIntoPlayerQueue([], -1, [t('a'), t('b')])!;
    expect(ids(r.queue)).toBe('a,b');
    expect(r.index).toBe(0);
  });

  it('Add to end goes after the last carlist song', () => {
    const r = mergeIntoPlayerQueue([t('a'), t('b'), t('c')], 1, [t('a'), t('b'), t('c'), t('d')])!;
    expect(ids(r.queue)).toBe('a,b,c,d');
    expect(r.index).toBe(1);
  });

  it('Play next goes right after the playing song, which keeps playing', () => {
    const r = mergeIntoPlayerQueue([t('a'), t('b'), t('c')], 1, [t('a'), t('b'), t('x'), t('c')])!;
    expect(ids(r.queue)).toBe('a,b,x,c');
    expect(r.index).toBe(1);
  });

  it('several new songs keep the carlist order', () => {
    const r = mergeIntoPlayerQueue([t('a'), t('b')], 0, [t('a'), t('y'), t('x'), t('b'), t('z')])!;
    expect(ids(r.queue)).toBe('a,y,x,b,z');
    expect(r.index).toBe(0);
  });

  it('songs before the playing one push its index along', () => {
    const r = mergeIntoPlayerQueue([t('b'), t('c')], 1, [t('a'), t('b'), t('n'), t('c')])!;
    // 'a' has nothing before it in the player: it goes to the end.
    expect(ids(r.queue)).toBe('b,n,c,a');
    expect(r.queue[r.index].id).toBe('c');
  });

  it('other songs already in the player stay ahead', () => {
    const r = mergeIntoPlayerQueue([t('p'), t('q')], 1, [t('a'), t('b')])!;
    expect(ids(r.queue)).toBe('p,q,a,b');
    expect(r.index).toBe(1);
  });
});

describe('sessionIndexFor', () => {
  it('finds the playing row', () => {
    expect(sessionIndexFor(['a', 'b', 'c'], 'b', 0)).toBe(1);
    expect(sessionIndexFor(['a', 'b', 'c'], 'z', 0)).toBe(-1);
    expect(sessionIndexFor(['a', 'b'], null, 0)).toBe(-1);
  });

  it('a song in twice: the copy at or after the last known row', () => {
    expect(sessionIndexFor(['a', 'b', 'a'], 'a', 1)).toBe(2);
    expect(sessionIndexFor(['a', 'b', 'a'], 'a', 0)).toBe(0);
    expect(sessionIndexFor(['a', 'b', 'c'], 'a', 2)).toBe(0);
  });
});

describe('people', () => {
  it('labels the viewer as You', () => {
    expect(personLabel({ id: 'u1', name: 'Hana' }, 'u1')).toBe('You');
    expect(personLabel({ id: 'u2', name: 'Marko' }, 'u1')).toBe('Marko');
    expect(personLabel(null, 'u1')).toBe('Unnamed member');
    expect(whosePhone('Hana', false)).toBe("Hana's phone plays");
    expect(whosePhone('Hana', true)).toBe('your phone plays');
  });
});

describe('estimateProgress', () => {
  it('server elapsed plus the time since the poll, over the duration', () => {
    expect(estimateProgress({ elapsedMs: 30_000, fetchedAt: 1000, now: 31_000, durationSec: 120 })).toBe(0.5);
    expect(estimateProgress({ elapsedMs: 0, fetchedAt: 1000, now: 1000, durationSec: 100 })).toBe(0);
  });

  it('stops at the end and is unknown without a duration or a time', () => {
    expect(estimateProgress({ elapsedMs: 999_000, fetchedAt: 1, now: 2, durationSec: 100 })).toBe(1);
    expect(estimateProgress({ elapsedMs: null, fetchedAt: 1, now: 2, durationSec: 100 })).toBeNull();
    expect(estimateProgress({ elapsedMs: 5, fetchedAt: 1, now: 2, durationSec: 0 })).toBeNull();
    expect(estimateProgress({ elapsedMs: 5, fetchedAt: 0, now: 2, durationSec: 10 })).toBeNull();
  });
});
