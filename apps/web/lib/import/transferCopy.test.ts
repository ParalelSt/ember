import { describe, expect, it } from 'vitest';
import { OVER_CAP_MESSAGE, RATE_LIMITED_MESSAGE, transferErrorMessage, UNKNOWN_MESSAGE } from './transferCopy';

describe('transferErrorMessage', () => {
  it('passes the route’s own sentences through', () => {
    for (const message of [
      'Choose a file or paste your songs.',
      'That file is over 20 MB. Ember reads song lists, not whole libraries of audio.',
      'That is a zip. Unzip it and upload the YourLibrary.json inside.',
      'There are no songs in that.',
    ]) {
      expect(transferErrorMessage(Object.assign(new Error(message), { status: 422 }))).toBe(message);
    }
  });

  it('says what the rate limit actually is, not how many seconds are left', () => {
    const e = Object.assign(new Error('Slow down, try again in about 900s.'), { status: 429 });
    expect(transferErrorMessage(e)).toBe(RATE_LIMITED_MESSAGE);
    expect(RATE_LIMITED_MESSAGE).toContain('five uploads');
  });

  it('falls back to a sentence when all there is is a status', () => {
    expect(transferErrorMessage(Object.assign(new Error('Request failed: 500'), { status: 500 }))).toBe(UNKNOWN_MESSAGE);
    expect(transferErrorMessage(new Error(''))).toBe(UNKNOWN_MESSAGE);
    expect(transferErrorMessage(undefined)).toBe(UNKNOWN_MESSAGE);
  });

  it('names the cap and what to do about it', () => {
    expect(OVER_CAP_MESSAGE).toContain('10,000');
    expect(OVER_CAP_MESSAGE).toContain('Split the file and upload it in parts.');
  });

  it('has no em dashes', () => {
    for (const s of [OVER_CAP_MESSAGE, RATE_LIMITED_MESSAGE, UNKNOWN_MESSAGE]) expect(s).not.toContain('—');
  });
});
