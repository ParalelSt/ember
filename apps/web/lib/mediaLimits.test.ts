import { describe, expect, it } from 'vitest';
import { exceedsMediaLimits, isTooLargeMessage, mediaLimits, tooLargeResponse } from './mediaLimits';

describe('mediaLimits', () => {
  it('defaults to 20 minutes and 60 MB', () => {
    expect(mediaLimits({})).toEqual({ maxSec: 1200, maxBytes: 60 * 1024 * 1024 });
  });

  it('follows the env, and ignores nonsense', () => {
    expect(mediaLimits({ EMBER_MAX_TRACK_MINUTES: '90', EMBER_MAX_DOWNLOAD_MB: '300' })).toEqual({ maxSec: 5400, maxBytes: 300 * 1024 * 1024 });
    expect(mediaLimits({ EMBER_MAX_TRACK_MINUTES: '-1', EMBER_MAX_DOWNLOAD_MB: 'lots' })).toEqual({ maxSec: 1200, maxBytes: 60 * 1024 * 1024 });
  });

  const limits = mediaLimits({});

  it('passes a normal song and unknown facts', () => {
    expect(exceedsMediaLimits({ durationSec: 240, filesize: 4_000_000 }, limits)).toBeNull();
    expect(exceedsMediaLimits({ durationSec: 1200 }, limits)).toBeNull();
    expect(exceedsMediaLimits({}, limits)).toBeNull();
  });

  it('refuses a long video, a huge file and a live stream', () => {
    expect(exceedsMediaLimits({ durationSec: 1201 }, limits)).toBe('too long: 21 min is over the 20 min limit');
    expect(exceedsMediaLimits({ filesize: 61 * 1024 * 1024 }, limits)).toBe('too large: 61 MB is over the 60 MB limit');
    expect(exceedsMediaLimits({ isLive: true }, limits)).toMatch(/^too long: live/);
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
