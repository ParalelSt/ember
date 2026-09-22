import { describe, expect, it } from 'vitest';
import { LIKED_NAV_KEY, navImportStates } from '@/lib/import/nav';
import type { ImportJob } from '@/lib/import/types';

const job = (over: Partial<ImportJob>): ImportJob => ({
  id: 'j',
  userId: 'u1',
  kind: 'playlist',
  playlistId: 'p',
  name: 'n',
  source: 'spotify',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 42,
  cursor: 18,
  accepted: 15,
  review: 2,
  missing: 1,
  existing: 0,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

describe('navImportStates', () => {
  it('a running import shows its count and ring', () => {
    expect(navImportStates([job({})])).toEqual({ p: { kind: 'importing', done: 18, total: 42 } });
    expect(navImportStates([job({ status: 'queued', cursor: 0 })]).p).toEqual({ kind: 'importing', done: 0, total: 42 });
  });

  it('a backoff pause still reads as importing; a pause for Retry says paused', () => {
    expect(navImportStates([job({ status: 'paused', retryAt: '2026-09-19T12:00:00Z' })]).p.kind).toBe('importing');
    expect(navImportStates([job({ status: 'paused' })]).p.kind).toBe('paused');
    expect(navImportStates([job({ status: 'failed' })]).p.kind).toBe('failed');
  });

  it('a finished import shows what is left to review, or nothing', () => {
    expect(navImportStates([job({ status: 'done', review: 4 })]).p).toEqual({ kind: 'review', count: 4 });
    expect(navImportStates([job({ status: 'done', review: 0 })])).toEqual({});
  });

  it('a transfer rings the Liked songs row, not a playlist', () => {
    const states = navImportStates([job({ kind: 'liked', playlistId: null, status: 'running', cursor: 7 })]);
    expect(states).toEqual({ [LIKED_NAV_KEY]: { kind: 'importing', done: 7, total: 42 } });
  });

  it('a transfer and a playlist import ring their own rows at once', () => {
    const states = navImportStates([
      job({ id: 't', kind: 'liked', playlistId: null, status: 'done', review: 3 }),
      job({ id: 'p', status: 'running' }),
    ]);
    expect(states).toEqual({
      [LIKED_NAV_KEY]: { kind: 'review', count: 3 },
      p: { kind: 'importing', done: 18, total: 42 },
    });
  });

  it('the newest job per playlist wins and dismissed ones are ignored', () => {
    const states = navImportStates([
      job({ id: 'new', status: 'running', cursor: 3 }),
      job({ id: 'old', status: 'done', review: 9 }),
      job({ id: 'x', playlistId: 'q', status: 'failed', dismissed: true }),
    ]);
    expect(states).toEqual({ p: { kind: 'importing', done: 3, total: 42 } });
  });
});
