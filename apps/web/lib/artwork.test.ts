import { describe, expect, it } from 'vitest';
import { pickThumbnail } from './artwork';

describe('pickThumbnail', () => {
  it('returns the last thumbnail\'s url', () => {
    const thumbnails = [
      { url: 'https://example.com/small.jpg' },
      { url: 'https://example.com/large.jpg' },
    ];
    expect(pickThumbnail(thumbnails)).toBe('https://example.com/large.jpg');
  });

  it('returns null for an empty list', () => {
    expect(pickThumbnail([])).toBeNull();
  });

  it('returns null for null or undefined', () => {
    expect(pickThumbnail(null)).toBeNull();
    expect(pickThumbnail(undefined)).toBeNull();
  });
});
