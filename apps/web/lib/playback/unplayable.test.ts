import { describe, expect, it } from 'vitest';
import { reasonLabel, summarizeUnplayable, unplayableMessage, type UnplayableNotice } from './unplayable';

const n = (over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
  trackId: 'youtube:a', title: 'Klinček stoji pod oblokom', kind: 'unavailable', reason: 'unavailable', outcome: 'skipped', ...over,
});

describe('unplayableMessage', () => {
  it('names the song and says it was skipped (the wording from the report)', () => {
    expect(unplayableMessage(n())).toBe('Couldn\'t play "Klinček stoji pod oblokom": not available on YouTube. Skipped to the next song.');
  });

  it.each([
    ['removed', 'removed from YouTube'],
    ['private', 'made private on YouTube'],
    ['geo', 'not available on YouTube in this country'],
    ['members', 'for YouTube channel members only'],
    ['terminated', 'its YouTube channel was closed'],
    ['unavailable', 'not available on YouTube'],
    [null, 'not available on YouTube'],
  ])('reason %s reads "%s"', (reason, phrase) => {
    expect(unplayableMessage(n({ title: 'X', reason }))).toBe(`Couldn't play "X": ${phrase}. Skipped to the next song.`);
  });

  it('a passing failure is "right now", not "gone"', () => {
    expect(unplayableMessage(n({ kind: 'transient', reason: null, title: 'X' }))).toBe('Couldn\'t load "X" right now. Skipped to the next song.');
    expect(unplayableMessage(n({ kind: 'transient', outcome: 'stopped', title: 'X' }))).toBe('Couldn\'t load "X" right now. Press play to try again.');
  });

  it('says so when the music stopped', () => {
    expect(unplayableMessage(n({ outcome: 'stopped', title: 'X' }))).toBe('Couldn\'t play "X": not available on YouTube. Nothing left to play.');
    expect(unplayableMessage(n({ outcome: 'gave-up', title: 'X' }))).toMatch(/Several songs in a row wouldn't play, so playback stopped\.$/);
  });

  it('a song only flagged ahead of time gets no message', () => {
    expect(unplayableMessage(n({ outcome: 'flagged' }))).toBeNull();
  });

  it('a song with no title still reads as a sentence', () => {
    expect(unplayableMessage(n({ title: '  ' }))).toBe("Couldn't play this song: not available on YouTube. Skipped to the next song.");
  });
});

describe('summarizeUnplayable', () => {
  it('one song is its own message', () => {
    expect(summarizeUnplayable([n()])).toBe(unplayableMessage(n()));
  });

  it('several songs become one line naming two and counting the rest', () => {
    const s = summarizeUnplayable([
      n({ trackId: '1', title: 'A' }), n({ trackId: '2', title: 'B' }), n({ trackId: '3', title: 'C' }),
    ]);
    expect(s).toBe('Couldn\'t play 3 songs ("A", "B" and 1 more): they\'re not available on YouTube. They were skipped.');
  });

  it('says playback stopped when the last one stopped it, and "wouldn\'t load" for mixed failures', () => {
    const s = summarizeUnplayable([
      n({ trackId: '1', title: 'A' }), n({ trackId: '2', title: 'B', kind: 'transient', outcome: 'gave-up' }),
    ]);
    expect(s).toBe('Couldn\'t play 2 songs ("A" and "B"): they wouldn\'t load. Playback stopped.');
  });

  it('counts a song once and leaves out the flagged ones', () => {
    expect(summarizeUnplayable([n({ outcome: 'flagged' })])).toBeNull();
    expect(summarizeUnplayable([n(), n({ outcome: 'gave-up' })])).toMatch(/^Couldn't play "Klinček/);
  });
});

describe('reasonLabel', () => {
  it('is short, for the queue row', () => {
    expect(reasonLabel('removed')).toBe('Removed from YouTube');
    expect(reasonLabel('whatever')).toBe('Not available');
  });
});
