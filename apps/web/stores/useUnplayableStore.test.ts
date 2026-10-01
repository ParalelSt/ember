import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCouldntPlay,
  dismissUnplayable,
  forgetCouldntPlay,
  recordCouldntPlay,
  resetUnplayableStore,
  settleUnplayable,
  showUnplayable,
  useUnplayableStore,
} from './useUnplayableStore';
import { BAR_MESSAGE_MS, barLines } from '@/lib/playback/unplayableBar';
import type { UnplayableNotice } from '@/lib/playback/unplayable';

const n = (id: string, over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
  trackId: id, title: id, kind: 'unavailable', reason: 'removed', outcome: 'skipped', ...over,
});
const message = () => useUnplayableStore.getState().message;
const top = () => { const m = message(); return m ? barLines(m).top : null; };

beforeEach(() => { vi.useFakeTimers(); resetUnplayableStore(); });
afterEach(() => { resetUnplayableStore(); vi.useRealTimers(); });

describe('the bar message: timing', () => {
  it('a skip shows for about 3 s, then the song is back', () => {
    showUnplayable([n('a')]);
    expect(top()).toBe('Skipped: a');
    vi.advanceTimersByTime(BAR_MESSAGE_MS - 1);
    expect(top()).toBe('Skipped: a');
    vi.advanceTimersByTime(1);
    expect(message()).toBeNull();
  });

  it('a burst joins the message on screen and the 3 s start again', () => {
    showUnplayable([n('a')]);
    const key = message()!.key;
    vi.advanceTimersByTime(2000);
    showUnplayable([n('b')]);
    vi.advanceTimersByTime(2000);
    showUnplayable([n('c')]);
    expect(top()).toBe('Skipped 3 songs');
    // Same message, new words: the bar does not fade in again.
    expect(message()!.key).toBe(key);
    vi.advanceTimersByTime(BAR_MESSAGE_MS - 1);
    expect(top()).toBe('Skipped 3 songs');
    vi.advanceTimersByTime(1);
    expect(message()).toBeNull();
  });

  it('a stop stays until the listener acts, however long', () => {
    showUnplayable([n('a'), n('b', { outcome: 'gave-up' })]);
    vi.advanceTimersByTime(60_000);
    expect(top()).toBe('Playback stopped');
    dismissUnplayable();
    expect(message()).toBeNull();
  });

  it('a skip burst that ends in the fifth failure turns into the stop, and stays', () => {
    showUnplayable([n('a')]);
    showUnplayable([n('b')]);
    showUnplayable([n('c', { outcome: 'gave-up' })]);
    expect(top()).toBe('Playback stopped');
    vi.advanceTimersByTime(BAR_MESSAGE_MS * 5);
    expect(top()).toBe('Playback stopped');
  });

  it('a transient stop stays; a new message after it replaces it instead of merging', () => {
    showUnplayable([n('a', { kind: 'transient', outcome: 'stopped' })]);
    vi.advanceTimersByTime(10_000);
    expect(barLines(message()!).retry).toBe(true);
    showUnplayable([n('b')]);
    expect(top()).toBe('Skipped: b');
  });

  it('the summary for while the app was away behaves like a skip', () => {
    showUnplayable([n('a'), n('b')], { away: true });
    expect(barLines(message()!).bottom).toMatch(/^While you were away/);
    vi.advanceTimersByTime(BAR_MESSAGE_MS);
    expect(message()).toBeNull();
  });

  it('only flagged songs say nothing', () => {
    showUnplayable([n('a', { outcome: 'flagged' })]);
    expect(message()).toBeNull();
  });
});

describe('the bar message: playback moving on', () => {
  it('a stop clears when another song is current or the music starts', () => {
    showUnplayable([n('a', { outcome: 'gave-up' })]);
    settleUnplayable('a', false);
    expect(message()).not.toBeNull();
    settleUnplayable('b', false);
    expect(message()).toBeNull();

    showUnplayable([n('a', { kind: 'transient', outcome: 'stopped' })]);
    settleUnplayable('a', true);
    expect(message()).toBeNull();
  });

  it('a skip is left to its timer (the player moving on is the skip itself)', () => {
    showUnplayable([n('a')]);
    settleUnplayable('b', true);
    expect(top()).toBe('Skipped: a');
  });
});

describe('the queue\'s "Couldn\'t play" list', () => {
  it('keeps one entry per song, latest word, oldest first; forgets one that played; clears for a new queue', () => {
    recordCouldntPlay([n('a'), n('b')]);
    recordCouldntPlay([n('a', { reason: 'geo' }), n('c', { outcome: 'flagged' })]);
    expect(useUnplayableStore.getState().couldntPlay.map((x) => [x.trackId, x.reason])).toEqual([['b', 'removed'], ['a', 'geo']]);
    forgetCouldntPlay('b');
    expect(useUnplayableStore.getState().couldntPlay.map((x) => x.trackId)).toEqual(['a']);
    clearCouldntPlay();
    expect(useUnplayableStore.getState().couldntPlay).toEqual([]);
  });
});
