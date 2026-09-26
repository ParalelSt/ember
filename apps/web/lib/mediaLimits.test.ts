import { describe, expect, it } from 'vitest';
import { exceedsMediaLimits, isTooLargeMessage, mediaLimits, tooLargeResponse } from './mediaLimits';

describe('mediaLimits', () => {
  it('defaults to unlimited', () => {
    expect(mediaLimits({})).toEqual({ maxSec: 0, maxBytes: 0 });
  });

  it('follows the env when it opts into a cap, and ignores nonsense', () => {
    expect(mediaLimits({ EMBER_MAX_TRACK_MINUTES: '90', EMBER_MAX_DOWNLOAD_MB: '300' })).toEqual({ maxSec: 5400, maxBytes: 300 * 1024 * 1024 });
    expect(mediaLimits({ EMBER_MAX_TRACK_MINUTES: '-1', EMBER_MAX_DOWNLOAD_MB: 'lots' })).toEqual({ maxSec: 0, maxBytes: 0 });
    expect(mediaLimits({ EMBER_MAX_TRACK_MINUTES: '0', EMBER_MAX_DOWNLOAD_MB: '0' })).toEqual({ maxSec: 0, maxBytes: 0 });
  });

  const limits = mediaLimits({});
  const capped = mediaLimits({ EMBER_MAX_TRACK_MINUTES: '20', EMBER_MAX_DOWNLOAD_MB: '60' });

  it('passes a normal song, an hour-long song and unknown facts when unlimited', () => {
    expect(exceedsMediaLimits({ durationSec: 240, filesize: 4_000_000 }, limits)).toBeNull();
    expect(exceedsMediaLimits({ durationSec: 3600 }, limits)).toBeNull();
    expect(exceedsMediaLimits({ filesize: 200 * 1024 * 1024 }, limits)).toBeNull();
    expect(exceedsMediaLimits({}, limits)).toBeNull();
  });

  it('always refuses a live stream, cap or no cap (it can never finish)', () => {
    expect(exceedsMediaLimits({ isLive: true }, limits)).toMatch(/^too long: live/);
    expect(exceedsMediaLimits({ isLive: true }, capped)).toMatch(/^too long: live/);
  });

  it('refuses a long video and a huge file only when the opt-in cap is set', () => {
    expect(exceedsMediaLimits({ durationSec: 1201 }, capped)).toBe('too long: 21 min is over the 20 min limit');
    expect(exceedsMediaLimits({ filesize: 61 * 1024 * 1024 }, capped)).toBe('too large: 61 MB is over the 60 MB limit');
  });

  it('recognises its own messages only', () => {
    expect(isTooLargeMessage('too long: 60 min is over the 20 min limit')).toBe(true);
    expect(isTooLargeMessage('too large: over the 60 MB limit')).toBe(true);
    expect(isTooLargeMessage('HTTP Error 403: Forbidden')).toBe(false);
    expect(isTooLargeMessage('Video unavailable, too long ago')).toBe(false);
  });

  it('answers 413 with a sentence', async () => {
    const res = tooLargeResponse('too long: 60 min is over the 20 min limit');
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'This video is too long to play on Ember (60 min is over the 20 min limit).', cause: 'too-long' });
  });
});
