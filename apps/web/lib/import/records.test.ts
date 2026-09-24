import { describe, expect, it } from 'vitest';
import { cleanPickedTrack, itemFromRecord, itemRecord, jobFromRecord, pbDate, pbMillis, readyItem } from '@/lib/import/records';
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
    // A row written before the transfer fields existed still reads as a
    // playlist import.
    expect(j).toMatchObject({ kind: 'playlist', existing: 0 });
  });

  it('maps a transfer job: no playlist, its own kind, its owner and the existing count', () => {
    const j = jobFromRecord({
      id: 'j3',
      user: 'u1',
      kind: 'liked',
      playlist: '',
      source: 'csv',
      status: 'running',
      total: 412,
      accepted: 380,
      existing: 38,
    });
    expect(j).toMatchObject({ kind: 'liked', playlistId: null, userId: 'u1', source: 'csv', existing: 38 });
    // Only a Google likes transfer counts likes that were not music.
    expect(j.notMusic).toBeUndefined();
  });

  it('a Google likes transfer counts the likes it got through that were not music', () => {
    const row = { id: 'j4', kind: 'liked', source: 'ytmusic', source_id: 'ytmusic-liked', status: 'done', total: 16, cursor: 16 };
    expect(jobFromRecord({ ...row, accepted: 5, review: 5, missing: 0 }).notMusic).toBe(6);
    // A person saying no to an upload makes one more.
    expect(jobFromRecord({ ...row, accepted: 5, review: 4, missing: 0 }).notMusic).toBe(7);
    // A YouTube Music playlist link into the likes is not one.
    expect(jobFromRecord({ ...row, source_id: 'PLabc', accepted: 5, review: 5 }).notMusic).toBeUndefined();
  });

  it('reads and writes an item liked_at, and leaves it empty when there is none', () => {
    const at = Date.UTC(2024, 4, 5, 6, 7, 8);
    const row = itemRecord('j1', { position: 0, title: 't', artists: [], artist: '', durationMs: null, explicit: null, uri: null }, [], at);
    expect(row.liked_at).toBe(pbDate(at));
    expect(itemFromRecord({ ...row, id: 'i1' }).likedAt).toBe(at);
    const plain = itemRecord('j1', { position: 0, title: 't', artists: [], artist: '', durationMs: null, explicit: null, uri: null });
    expect(plain.liked_at).toBe('');
    expect(itemFromRecord({ ...plain, id: 'i2' }).likedAt).toBeNull();
  });

  it('pbMillis reads PocketBase dates and shrugs at anything else', () => {
    expect(pbMillis('2026-09-19 12:00:05.000Z')).toBe(Date.parse('2026-09-19T12:00:05.000Z'));
    expect(pbMillis('')).toBeNull();
    expect(pbMillis(undefined)).toBeNull();
    expect(pbMillis('not a date')).toBeNull();
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
