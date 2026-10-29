// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import { presenceActivity } from './discord';

const track = (over: Partial<Track> = {}): Track => ({
  id: 'yt_x', source: 'youtube', sourceId: 'x', title: 'Song', artist: 'Band', artistId: null,
  album: 'Album', albumId: null, durationSec: 200, artworkUrl: 'https://i.ytimg.com/vi/x/hq.jpg', streamUrl: '',
  ...over,
});
const chars = (s: unknown) => [...String(s)].length;

// Discord refuses a whole activity whose details, state or large_text is
// under 2 characters, or whose large_image is over 256: the card then
// stayed on the previous song with nothing said.
describe('presenceActivity', () => {
  it('pads a one-character title (and an empty album) to Discord\'s minimum', () => {
    const a = presenceActivity(track({ title: '7', album: '' }), 0, 0, 1_000_000) as {
      details: string; assets: { large_text: string };
    };
    expect(a.details.startsWith('7')).toBe(true);
    expect(chars(a.details)).toBeGreaterThanOrEqual(2);
    expect(chars(a.assets.large_text)).toBeGreaterThanOrEqual(2);
  });

  it('counts an emoji title as one character', () => {
    const a = presenceActivity(track({ title: '🎵' }), 0, 0, 1_000_000) as { details: string };
    expect(chars(a.details)).toBeGreaterThanOrEqual(2);
  });

  it('drops an artwork URL over 256 characters instead of losing the update', () => {
    const long = `https://lh3.googleusercontent.com/${'a'.repeat(300)}`;
    const a = presenceActivity(track({ artworkUrl: long }), 0, 0, 1_000_000) as { assets: Record<string, unknown> };
    expect(a.assets.large_image).toBeUndefined();
    expect(a.assets.large_text).toBe('Album');
  });

  it('leaves an ordinary song as it was', () => {
    const a = presenceActivity(track(), 30, 200, 1_000_000) as {
      details: string; state: string; assets: Record<string, unknown>; timestamps: { start: number; end: number };
    };
    expect(a.details).toBe('Song');
    expect(a.state).toBe('by Band');
    expect(a.assets.large_image).toBe('https://i.ytimg.com/vi/x/hq.jpg');
    expect(a.timestamps).toEqual({ start: 970_000, end: 1_170_000 });
  });
});
