import { describe, expect, it } from 'vitest';
import { barLines, shortReason, songsOf } from './unplayableBar';
import type { UnplayableNotice } from './unplayable';

const n = (id: string, over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
  trackId: id, title: id, kind: 'unavailable', reason: 'removed', outcome: 'skipped', ...over,
});
const lines = (notices: UnplayableNotice[], away = false) => barLines({ notices, away });

describe('the bar\'s words for songs that could not play', () => {
  it('one skip: "Skipped: <title>", the reason under it, gone by itself', () => {
    expect(lines([n('Field Day')])).toMatchObject({
      top: 'Skipped: Field Day', bottom: 'Removed from YouTube', sticky: false, retry: false,
    });
  });

  it('every reason has its few words; an unknown one is "Not available on YouTube"', () => {
    expect(shortReason({ kind: 'unavailable', reason: 'private' })).toBe('Made private');
    expect(shortReason({ kind: 'unavailable', reason: 'geo' })).toBe('Blocked in this country');
    expect(shortReason({ kind: 'unavailable', reason: 'members' })).toBe('Members only');
    expect(shortReason({ kind: 'unavailable', reason: 'terminated' })).toBe('Channel closed');
    expect(shortReason({ kind: 'unavailable', reason: 'unavailable' })).toBe('Not available on YouTube');
    expect(shortReason({ kind: 'unavailable', reason: null })).toBe('Not available on YouTube');
    expect(shortReason({ kind: 'transient', reason: null })).toBe("Couldn't load right now");
  });

  it('a burst is one message: "Skipped 3 songs"', () => {
    expect(lines([n('a', { reason: null }), n('b', { reason: 'unavailable' }), n('c', { reason: null })])).toMatchObject({
      top: 'Skipped 3 songs', bottom: 'Not available on YouTube', sticky: false,
    });
  });

  it('a burst with one shared reason says it; mixed gone songs say "Not available on YouTube"', () => {
    expect(lines([n('a', { reason: 'geo' }), n('b', { reason: 'geo' })]).bottom).toBe('Blocked in this country');
    expect(lines([n('a', { reason: 'geo' }), n('b', { reason: 'private' })]).bottom).toBe('Not available on YouTube');
    expect(lines([n('a'), n('b', { kind: 'transient' })]).bottom).toBe("They wouldn't play");
  });

  it('the same song twice counts once (a skip, then the stop on it)', () => {
    expect(songsOf([n('a'), n('a', { outcome: 'gave-up' }), n('b', { outcome: 'flagged' })])).toEqual([n('a', { outcome: 'gave-up' })]);
  });

  it('a passing failure the player stopped at: "Couldn\'t load <title> right now", tap to retry, stays', () => {
    expect(lines([n('Glass Coast', { kind: 'transient', reason: null, outcome: 'stopped' })])).toMatchObject({
      top: "Couldn't load Glass Coast right now", bottom: 'Tap to retry', sticky: true, retry: true,
    });
  });

  it('five in a row: "Playback stopped", stays', () => {
    const l = lines([n('a'), n('b'), n('c'), n('d'), n('e', { outcome: 'gave-up' })]);
    expect(l).toMatchObject({ top: 'Playback stopped', bottom: "5 songs in a row couldn't play", sticky: true, retry: false });
  });

  it('a gone song with nothing after it: says so, stays', () => {
    expect(lines([n('Last', { outcome: 'stopped', reason: 'private' })])).toMatchObject({
      top: "Couldn't play: Last", bottom: 'Made private · Nothing left to play', sticky: true, retry: false,
    });
  });

  it('while you were away: "Skipped N songs", "While you were away" under it', () => {
    expect(lines([n('a', { reason: null }), n('b', { reason: null }), n('c', { reason: null })], true)).toMatchObject({
      top: 'Skipped 3 songs', bottom: 'While you were away · Not available on YouTube', sticky: false,
    });
    expect(lines([n('a', { reason: 'geo' })], true).bottom).toBe('While you were away · Blocked in this country');
  });

  it('the screen reader hears the whole sentence', () => {
    expect(lines([n('Field Day')]).announcement).toBe('Couldn\'t play "Field Day": removed from YouTube. Skipped to the next song.');
    expect(lines([n('a'), n('b')]).announcement).toMatch(/^Couldn't play 2 songs/);
    expect(lines([n('a'), n('b')], true).announcement).toMatch(/^While you were away: Couldn't play 2 songs/);
  });
});
