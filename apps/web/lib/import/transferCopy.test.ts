import { describe, expect, it } from 'vitest';
import {
  OVER_CAP_MESSAGE,
  plainTransferResult,
  RATE_LIMITED_MESSAGE,
  transferErrorMessage,
  UNKNOWN_MESSAGE,
} from './transferCopy';

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

describe('plainTransferResult', () => {
  it('says what happened as a sentence, the way the owner asked for it', () => {
    expect(plainTransferResult({ found: 812, check: 41, notFound: 6 })).toBe(
      'We found 812 songs. 41 need a quick check, 6 we could not find.',
    );
  });

  it('a route that never searches by name has nothing to report but the count', () => {
    expect(plainTransferResult({ found: 340, check: 0, notFound: 0 })).toBe('We found all 340 songs. Nothing to check.');
  });

  it('counts songs the person already had, and only when there are some', () => {
    expect(plainTransferResult({ found: 1042, check: 61, notFound: 18, existing: 21 })).toBe(
      'We found 1042 songs. 61 need a quick check, 18 we could not find, 21 you already had.',
    );
    expect(plainTransferResult({ found: 10, check: 0, notFound: 0, existing: 0 })).not.toContain('already had');
  });

  it('counts of one read as one', () => {
    expect(plainTransferResult({ found: 1, check: 1, notFound: 0 })).toBe('We found 1 song. 1 needs a quick check.');
  });

  it('nothing found at all is still a sentence', () => {
    expect(plainTransferResult({ found: 0, check: 0, notFound: 4 })).toBe(
      'We found none of your songs. 4 we could not find.',
    );
    expect(plainTransferResult({ found: 0, check: 0, notFound: 0 })).toBe('We found none of your songs.');
  });

  it('has no em dashes', () => {
    expect(plainTransferResult({ found: 3, check: 1, notFound: 1, existing: 1 })).not.toContain('\u2014');
  });
});
