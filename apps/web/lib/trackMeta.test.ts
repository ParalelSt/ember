import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getTrack = vi.fn();
const findArtistId = vi.fn();
vi.mock('@/lib/sources/youtube', () => ({
  getTrack: (...a: unknown[]) => getTrack(...a),
  findArtistId: (...a: unknown[]) => findArtistId(...a),
}));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/mapTrack', () => ({ mapTrackRow: vi.fn() }));

import { clearArtistIdCache, resolveArtistIdFor } from './trackMeta';

beforeEach(() => {
  clearArtistIdCache();
  getTrack.mockReset();
  findArtistId.mockReset();
});

describe('resolveArtistIdFor', () => {
  it('prefers the YT Music artist over the uploader channel', async () => {
    getTrack.mockResolvedValue({ artistId: 'UCuploader' });
    findArtistId.mockResolvedValue('UCartist');
    expect(await resolveArtistIdFor('Sn1HdLrl94A', 'Peki')).toBe('UCartist');
  });

  it('falls back to the uploader channel when no artist matches', async () => {
    getTrack.mockResolvedValue({ artistId: 'UCuploader' });
    findArtistId.mockResolvedValue(null);
    expect(await resolveArtistIdFor('Sn1HdLrl94A', 'Peki')).toBe('UCuploader');
  });

  it('uses the artist match when the track lookup fails', async () => {
    getTrack.mockRejectedValue(new Error('boom'));
    findArtistId.mockResolvedValue('UCartist');
    expect(await resolveArtistIdFor('Sn1HdLrl94A', 'Peki')).toBe('UCartist');
  });

  it('returns null when nothing resolves', async () => {
    getTrack.mockResolvedValue(null);
    findArtistId.mockRejectedValue(new Error('boom'));
    expect(await resolveArtistIdFor('Sn1HdLrl94A', 'Peki')).toBeNull();
  });

  it('caches answers so the helper runs once', async () => {
    getTrack.mockResolvedValue(null);
    findArtistId.mockResolvedValue('UCartist');
    await resolveArtistIdFor('Sn1HdLrl94A', 'Peki');
    await resolveArtistIdFor('Sn1HdLrl94A', 'Peki');
    expect(findArtistId).toHaveBeenCalledTimes(1);
    expect(getTrack).toHaveBeenCalledTimes(1);
  });

  it('answers null at the timeout, then serves the late answer from cache', async () => {
    vi.useFakeTimers();
    try {
      let release!: (v: string) => void;
      findArtistId.mockReturnValue(new Promise<string>((r) => { release = r; }));
      getTrack.mockResolvedValue(null);
      const first = resolveArtistIdFor('Sn1HdLrl94A', 'Peki');
      await vi.advanceTimersByTimeAsync(3500);
      expect(await first).toBeNull();
      release('UCartist');
      await vi.advanceTimersByTimeAsync(0);
      expect(await resolveArtistIdFor('Sn1HdLrl94A', 'Peki')).toBe('UCartist');
    } finally {
      vi.useRealTimers();
    }
  });
});
