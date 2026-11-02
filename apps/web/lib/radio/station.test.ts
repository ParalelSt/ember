import { describe, expect, it } from 'vitest';
import { isStationStreamUrl, stationStreamPath } from './station';

describe('isStationStreamUrl', () => {
  it('matches the station proxy, relative or absolute', () => {
    const path = stationStreamPath('0a1b2c3d-0000-4000-8000-000000000000');
    expect(isStationStreamUrl(path)).toBe(true);
    expect(isStationStreamUrl(`https://ember.example${path}`)).toBe(true);
  });

  it('does not match songs or empty values', () => {
    expect(isStationStreamUrl('/api/youtube/stream/abc')).toBe(false);
    expect(isStationStreamUrl('/api/radio/stream/')).toBe(false);
    expect(isStationStreamUrl('')).toBe(false);
    expect(isStationStreamUrl(null)).toBe(false);
    expect(isStationStreamUrl(undefined)).toBe(false);
  });
});
