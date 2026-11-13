import { describe, expect, it } from 'vitest';
import { QUIET_AFTER_PLAY_MS, offerKey, reminderDelay } from './reminder';
import type { UpdateOffer } from './check';

const offer: UpdateOffer = { kind: 'web', version: '0.7.44', canApply: true };
const NOW = 1_000_000;

describe('reminderDelay', () => {
  it('shows a new update at once when nothing is playing', () => {
    expect(reminderDelay({ offer, shown: new Set(), isPlaying: false, playingSince: 0, now: NOW })).toBe(0);
  });

  it('shows nothing without an update', () => {
    expect(reminderDelay({ offer: null, shown: new Set(), isPlaying: false, playingSince: 0, now: NOW })).toBeNull();
  });

  it('shows each version once per app start', () => {
    const shown = new Set([offerKey(offer)]);
    expect(reminderDelay({ offer, shown, isPlaying: false, playingSince: 0, now: NOW })).toBeNull();
    // A newer one than the one already shown is news again.
    expect(reminderDelay({ offer: { ...offer, version: '0.7.45' }, shown, isPlaying: false, playingSince: 0, now: NOW })).toBe(0);
  });

  it('keeps away from the first seconds of a song starting', () => {
    expect(reminderDelay({ offer, shown: new Set(), isPlaying: true, playingSince: NOW - 3000, now: NOW })).toBe(
      QUIET_AFTER_PLAY_MS - 3000,
    );
    expect(reminderDelay({ offer, shown: new Set(), isPlaying: true, playingSince: NOW - QUIET_AFTER_PLAY_MS, now: NOW })).toBe(0);
  });

  it('a song that has been playing a while does not hold it back', () => {
    expect(reminderDelay({ offer, shown: new Set(), isPlaying: true, playingSince: NOW - 60_000, now: NOW })).toBe(0);
  });
});
