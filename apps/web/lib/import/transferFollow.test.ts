import { describe, expect, it } from 'vitest';
import { chipState, followedTransfer, isExactJob, shouldNotify, toCheck } from './transferFollow';
import type { ImportJob } from './types';

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  userId: 'u1',
  kind: 'liked',
  playlistId: null,
  name: 'Liked songs from Spotify',
  source: 'spotify-export',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 200,
  cursor: 50,
  accepted: 40,
  review: 6,
  missing: 4,
  existing: 0,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

describe('followedTransfer', () => {
  it('follows the newest transfer into the likes that is not dismissed', () => {
    const jobs = [job({ id: 'a', dismissed: true }), job({ id: 'b' }), job({ id: 'c' })];
    expect(followedTransfer(jobs, [])?.id).toBe('b');
  });

  it('a playlist import only when this device started it from the Transfer page', () => {
    const pl = job({ id: 'p', kind: 'playlist', playlistId: 'pl1' });
    expect(followedTransfer([pl], [])).toBeNull();
    expect(followedTransfer([pl], ['p'])?.id).toBe('p');
  });
});

describe('chipState', () => {
  it('running: how far, as a percentage', () => {
    expect(chipState(job())).toEqual({ kind: 'running', done: 50, total: 200, percent: 25 });
    expect(chipState(job({ status: 'queued', cursor: 0 }))).toMatchObject({ kind: 'running', percent: 0 });
    // A backoff carries on by itself.
    expect(chipState(job({ status: 'paused', retryAt: '2026-10-07T10:00:00Z' }))).toMatchObject({ kind: 'running' });
  });

  it('stopped and waiting for Retry: says why', () => {
    expect(chipState(job({ status: 'paused', error: 'YouTube Music is busy.' }))).toEqual({ kind: 'paused', message: 'YouTube Music is busy.' });
    expect(chipState(job({ status: 'failed' }))).toMatchObject({ kind: 'paused' });
  });

  it('finished: the songs to check, or done', () => {
    expect(chipState(job({ status: 'done' }))).toEqual({ kind: 'check', count: 10 });
    expect(chipState(job({ status: 'done', review: 0, missing: 0 }))).toEqual({ kind: 'done' });
    expect(toCheck(job())).toBe(10);
  });
});

describe('shouldNotify', () => {
  const done = job({ status: 'done' });
  it('once a transfer seen running finishes', () => {
    expect(shouldNotify('running', done, [], [])).toBe(true);
    expect(shouldNotify('queued', job({ status: 'cancelled' }), [], [])).toBe(true);
  });

  it('for one started here that finished while the app was closed', () => {
    expect(shouldNotify(undefined, done, ['j1'], [])).toBe(true);
  });

  it('never for an old transfer, one still running, or twice', () => {
    expect(shouldNotify(undefined, done, [], [])).toBe(false);
    expect(shouldNotify('running', job(), ['j1'], [])).toBe(false);
    expect(shouldNotify('running', done, ['j1'], ['j1'])).toBe(false);
  });
});

describe('isExactJob', () => {
  it('a YouTube Music source names its own videos', () => {
    expect(isExactJob(job({ source: 'ytmusic' }))).toBe(true);
    expect(isExactJob(job())).toBe(false);
  });
});
