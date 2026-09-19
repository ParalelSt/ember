import { describe, expect, it } from 'vitest';
import {
  canTransition,
  countItems,
  InvalidTransition,
  isActive,
  playlistPosition,
  transition,
  type JobEvent,
  type JobStatus,
} from '@/lib/import/jobState';

const STATUSES: JobStatus[] = ['queued', 'running', 'paused', 'done', 'failed', 'cancelled'];
const EVENTS: JobEvent[] = ['claim', 'backoff', 'resume', 'give-up', 'finish', 'fail', 'cancel', 'retry', 'boot'];

describe('import job state machine', () => {
  it('walks the happy path: queued, running, done', () => {
    expect(transition('queued', 'claim')).toBe('running');
    expect(transition('running', 'finish')).toBe('done');
  });

  it('a backoff pauses and resumes; giving up waits for Retry', () => {
    expect(transition('running', 'backoff')).toBe('paused');
    expect(transition('paused', 'resume')).toBe('running');
    expect(transition('running', 'give-up')).toBe('paused');
    expect(transition('paused', 'retry')).toBe('queued');
  });

  it('a failed job is retryable, a restart re-queues a running one', () => {
    expect(transition('running', 'fail')).toBe('failed');
    expect(transition('failed', 'retry')).toBe('queued');
    expect(transition('running', 'boot')).toBe('queued');
    expect(transition('paused', 'boot')).toBe('queued');
  });

  it('anything unfinished can be cancelled', () => {
    for (const s of ['queued', 'running', 'paused', 'failed'] as const) expect(transition(s, 'cancel')).toBe('cancelled');
  });

  it('done and cancelled are final', () => {
    for (const e of EVENTS) {
      expect(canTransition('done', e)).toBe(false);
      expect(canTransition('cancelled', e)).toBe(false);
    }
    expect(() => transition('done', 'retry')).toThrow(InvalidTransition);
  });

  it('refuses the transitions that make no sense', () => {
    expect(canTransition('queued', 'finish')).toBe(false);
    expect(canTransition('queued', 'resume')).toBe(false);
    expect(canTransition('running', 'retry')).toBe(false);
    expect(canTransition('failed', 'claim')).toBe(false);
    expect(() => transition('queued', 'finish')).toThrow(/queued cannot finish/);
  });

  it('every allowed transition lands on a known status', () => {
    for (const s of STATUSES) {
      for (const e of EVENTS) if (canTransition(s, e)) expect(STATUSES).toContain(transition(s, e));
    }
  });

  it('queued, running and paused keep the page polling', () => {
    expect(STATUSES.filter(isActive)).toEqual(['queued', 'running', 'paused']);
  });
});

describe('playlistPosition', () => {
  it('puts a source item at its own 1-based position', () => {
    expect(playlistPosition(0)).toBe(1);
    expect(playlistPosition(41)).toBe(42);
  });

  it('tracks added out of order still sort into source order', () => {
    const added = [5, 0, 3, 1, 4, 2].map((p) => ({ p, position: playlistPosition(p) }));
    expect(added.sort((a, b) => a.position - b.position).map((a) => a.p)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('countItems', () => {
  it('counts accepted and resolved as added, and ignores pending and skipped', () => {
    expect(countItems(['accepted', 'resolved', 'review', 'missing', 'missing', 'pending', 'skipped'])).toEqual({
      accepted: 2,
      review: 1,
      missing: 2,
    });
  });
});
