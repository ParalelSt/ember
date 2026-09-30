import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetFailureMemo,
  forgetFailure,
  recentFailure,
  rememberTransient,
  rememberUnavailable,
  TRANSIENT_MEMO_MS,
  UNAVAILABLE_MEMO_MS,
  unavailableTrackIds,
} from './failureMemo';

const T0 = 1_000_000;

beforeEach(() => _resetFailureMemo());

describe('failureMemo', () => {
  it('remembers an unavailable video for hours, with its reason', () => {
    rememberUnavailable('gone0000001', 'removed', 'Video unavailable', T0);
    expect(recentFailure('gone0000001', T0 + UNAVAILABLE_MEMO_MS - 1)).toMatchObject({ kind: 'unavailable', reason: 'removed' });
    expect(recentFailure('gone0000001', T0 + UNAVAILABLE_MEMO_MS)).toBeNull();
  });

  it('remembers a passing failure for two minutes only', () => {
    rememberTransient('glitch00001', 'HTTP Error 403', T0);
    expect(recentFailure('glitch00001', T0 + TRANSIENT_MEMO_MS - 1)).toMatchObject({ kind: 'transient' });
    expect(recentFailure('glitch00001', T0 + TRANSIENT_MEMO_MS)).toBeNull();
    expect(TRANSIENT_MEMO_MS).toBe(2 * 60 * 1000);
  });

  it('a passing failure never hides a known "gone"', () => {
    rememberUnavailable('gone0000001', 'private', 'Private video', T0);
    rememberTransient('gone0000001', 'timed out', T0 + 1);
    expect(recentFailure('gone0000001', T0 + 2)).toMatchObject({ kind: 'unavailable', reason: 'private' });
  });

  it('a later "gone" replaces a passing failure', () => {
    rememberTransient('x0000000001', 'timed out', T0);
    rememberUnavailable('x0000000001', 'geo', 'not available in your country', T0 + 1);
    expect(recentFailure('x0000000001', T0 + 2)).toMatchObject({ kind: 'unavailable', reason: 'geo' });
  });

  it('forgets a video that played after all', () => {
    rememberUnavailable('back0000001', 'unavailable', 'This video is not available', T0);
    forgetFailure('back0000001');
    expect(recentFailure('back0000001', T0)).toBeNull();
  });

  it('lists only unavailable ones as track ids, for radio', () => {
    rememberUnavailable('gone0000001', 'removed', 'x', T0);
    rememberTransient('glitch00001', 'y', T0);
    expect(unavailableTrackIds(T0 + 1)).toEqual(new Set(['youtube:gone0000001']));
    expect(unavailableTrackIds(T0 + UNAVAILABLE_MEMO_MS)).toEqual(new Set());
  });

  it('stays bounded', () => {
    for (let i = 0; i < 2500; i++) rememberUnavailable(`id${String(i).padStart(9, '0')}`, 'removed', 'x', T0);
    expect(unavailableTrackIds(T0).size).toBe(2000);
    // The oldest went first; the newest are all there.
    expect(recentFailure('id000000000', T0)).toBeNull();
    expect(recentFailure('id000002499', T0)).not.toBeNull();
  });

  it('is one memory per process, even when each route bundles its own copy', async () => {
    rememberUnavailable('shared00001', 'removed', 'x');
    vi.resetModules();
    const other = await import('./failureMemo');
    expect(other.recentFailure('shared00001')).toMatchObject({ kind: 'unavailable', reason: 'removed' });
  });
});
