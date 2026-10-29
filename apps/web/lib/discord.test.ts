// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import { presenceActivity } from './discord';
import { stationSongTrack, stationTrack } from '@/lib/radio/station';

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

describe('presenceActivity for a radio station', () => {
  const station = stationTrack({
    id: '00000000-0000-4000-8000-000000000001', name: 'Antena Zagreb', favicon: 'https://antena.example/logo.png', state: 'Grad Zagreb', country: 'Croatia',
  });
  type Card = { details: string; state: string; timestamps: object; assets: { large_image: string; large_text: string } };

  it('shows the song the station is playing like a song, the station where the album goes', () => {
    const a = presenceActivity(stationSongTrack(station, { artist: 'Severina', title: 'Italiana' }), 30, 0, 1_000_000) as Card;
    expect(a.details).toBe('Italiana');
    expect(a.state).toBe('by Severina');
    expect(a.assets).toEqual({ large_image: 'https://antena.example/logo.png', large_text: 'Antena Zagreb' });
    expect(a.timestamps).toEqual({ start: 970_000 });
  });

  it('names the station as the artist for a title with no artist part', () => {
    const a = presenceActivity(stationSongTrack(station, { artist: null, title: 'Jutarnji program' }), 0, 0) as Card;
    expect(a.details).toBe('Jutarnji program');
    expect(a.state).toBe('by Antena Zagreb');
  });

  it('shows the station as before when no song is known', () => {
    const a = presenceActivity(stationSongTrack(station, null), 0, 0) as Card;
    expect(a.details).toBe('Antena Zagreb');
    expect(a.state).toBe('by Grad Zagreb, Croatia');
    expect(a.assets.large_text).toBe('Antena Zagreb');
  });

  it('leaves a song track alone', () => {
    const song = track();
    expect(stationSongTrack(song, { artist: 'X', title: 'Y' })).toBe(song);
    expect(stationSongTrack(null, { artist: 'X', title: 'Y' })).toBeNull();
  });
});
