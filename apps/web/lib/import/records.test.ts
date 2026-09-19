import { describe, expect, it } from 'vitest';
import { cleanPickedTrack, itemFromRecord, itemRecord, jobFromRecord, pbDate, readyItem } from '@/lib/import/records';
import type { Track } from '@/types/track';

const yt: Track = {
  id: 'youtube:abcdefghijk',
  source: 'youtube',
  sourceId: 'abcdefghijk',
  title: 'Song',
  artist: 'Band',
  artistId: 'UC1',
  album: 'LP',
  albumId: 'MPRE1',
  durationSec: 201.4,
  artworkUrl: 'https://i.ytimg.com/a.jpg',
  streamUrl: '/api/youtube/stream/abcdefghijk',
};

describe('import records', () => {
  it('maps a job row, with PocketBase dates as ISO', () => {
    const j = jobFromRecord({
      id: 'j1',
      playlist: 'p1',
      name: 'Mix',
      source: 'spotify',
      source_url: 'u',
      cover_url: '',
      status: 'paused',
      total: 42,
      cursor: 18,
      accepted: 15,
      review: 2,
      missing: 1,
      error: 'slow down',
      retry_at: '2026-09-19 12:00:05.000Z',
      dismissed: false,
    });
    expect(j).toMatchObject({ id: 'j1', playlistId: 'p1', status: 'paused', cursor: 18, total: 42, coverUrl: null });
    expect(j.retryAt).toBe('2026-09-19T12:00:05.000Z');
    expect(jobFromRecord({ id: 'j2', retry_at: '' }).retryAt).toBeNull();
  });

  it('round-trips a source item through its row', () => {
    const row = itemRecord('j1', {
      position: 3,
      title: 'Loser',
      artists: ['Tame Impala'],
      artist: 'Tame Impala',
      durationMs: 223000,
      explicit: null,
      uri: 'spotify:track:x',
    });
    const item = itemFromRecord({ id: 'i1', ...row });
    expect(item).toMatchObject({ id: 'i1', position: 3, status: 'pending', videoId: null, confidence: null, candidates: [] });
    expect(item.source).toMatchObject({ title: 'Loser', artist: 'Tame Impala', durationMs: 223000, explicit: null });
  });

  it('drops malformed candidates', () => {
    const item = itemFromRecord({ id: 'i', status: 'review', confidence: 60, candidates: [{ track: yt, score: 60 }, { nope: 1 }, null] });
    expect(item.candidates).toHaveLength(1);
    expect(item.confidence).toBe(60);
  });

  it('a YouTube playlist track becomes a ready, certain candidate', () => {
    const { item, candidates } = readyItem(yt, 4);
    expect(item).toMatchObject({ position: 4, title: 'Song', artist: 'Band', durationMs: 201400 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ score: 100, track: yt });
  });

  it('pbDate writes the format PocketBase compares as text', () => {
    expect(pbDate(Date.UTC(2026, 8, 19, 12, 0, 5))).toBe('2026-09-19 12:00:05.000Z');
  });
});

describe('cleanPickedTrack', () => {
  it('keeps a YouTube track, rebuilt from its known fields', () => {
    const t = cleanPickedTrack({ ...yt, extra: 'x', streamUrl: 'http://evil' });
    expect(t).toEqual({ ...yt, durationSec: 201, streamUrl: '/api/youtube/stream/abcdefghijk' });
  });

  it('refuses anything that is not a YouTube video', () => {
    expect(cleanPickedTrack(null)).toBeNull();
    expect(cleanPickedTrack({ ...yt, source: 'upload' })).toBeNull();
    expect(cleanPickedTrack({ ...yt, sourceId: 'short' , id: 'youtube:short' })).toBeNull();
    expect(cleanPickedTrack({ ...yt, id: 'youtube:zzzzzzzzzzz' })).toBeNull();
    expect(cleanPickedTrack({ ...yt, title: '' })).toBeNull();
  });

  it('drops an artwork URL that is not https', () => {
    expect(cleanPickedTrack({ ...yt, artworkUrl: 'javascript:alert(1)' })?.artworkUrl).toBeNull();
  });
});
