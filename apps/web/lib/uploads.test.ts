import { describe, expect, it } from 'vitest';
import type { RecordModel } from 'pocketbase';
import { hasUploadArt, mapUpload, newFilename, resolveUploadPath, sniffAudio } from '@/lib/uploads';

function row(over: Partial<RecordModel> = {}): RecordModel {
  return {
    id: 'rec1',
    collectionId: 'c',
    collectionName: 'uploads',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration_sec: 123,
    filename: 'abc.mp3',
    ...over,
  } as RecordModel;
}

describe('hasUploadArt', () => {
  it('is true only for the extensions the extractor writes', () => {
    expect(hasUploadArt(row({ artwork_ext: 'jpg' }))).toBe(true);
    expect(hasUploadArt(row({ artwork_ext: 'png' }))).toBe(true);
    expect(hasUploadArt(row({ artwork_ext: 'gif' }))).toBe(false);
    expect(hasUploadArt(row({ artwork_ext: '' }))).toBe(false);
    expect(hasUploadArt(row())).toBe(false);
  });
});

describe('mapUpload', () => {
  it('points artworkUrl at the art route when the record has a cover', () => {
    expect(mapUpload(row({ artwork_ext: 'jpg' })).artworkUrl).toBe('/api/uploads/rec1/art');
    expect(mapUpload(row({ artwork_ext: 'png' })).artworkUrl).toBe('/api/uploads/rec1/art');
  });

  it('leaves artworkUrl null for uploads from before covers were extracted', () => {
    expect(mapUpload(row()).artworkUrl).toBeNull();
    expect(mapUpload(row({ artwork_ext: '' })).artworkUrl).toBeNull();
  });

  it('leaves artworkUrl null for an extension we would not serve', () => {
    expect(mapUpload(row({ artwork_ext: '../x' })).artworkUrl).toBeNull();
  });

  it('maps the rest of the record onto the Track shape', () => {
    const track = mapUpload(row({ artwork_ext: 'jpg' }));
    expect(track).toMatchObject({
      id: 'upload:rec1',
      source: 'upload',
      sourceId: 'rec1',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      durationSec: 123,
      streamUrl: '/api/uploads/rec1/stream',
    });
  });

  it('falls back for missing text fields', () => {
    const track = mapUpload(row({ title: undefined, artist: '', album: '', duration_sec: undefined }));
    expect(track.title).toBe('Untitled');
    expect(track.artist).toBe('Unknown artist');
    expect(track.album).toBeNull();
    expect(track.durationSec).toBe(0);
  });
});

describe('resolveUploadPath', () => {
  it('accepts a plain cover filename', () => {
    expect(resolveUploadPath('rec1.jpg')).toMatch(/uploads\/rec1\.jpg$/);
  });

  it('refuses anything that could escape the uploads directory', () => {
    expect(resolveUploadPath('../secret.jpg')).toBeNull();
    expect(resolveUploadPath('sub/rec1.jpg')).toBeNull();
    expect(resolveUploadPath('')).toBeNull();
  });
});

describe('sniffAudio', () => {
  it('recognises an ID3-tagged MP3', () => {
    expect(sniffAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]))).toBe('.mp3');
  });

  it('returns null for something that is not audio', () => {
    expect(sniffAudio(Buffer.from('this is plain text, at length'))).toBeNull();
  });
});

describe('newFilename', () => {
  it('keeps the extension and never reuses a name', () => {
    const a = newFilename('.mp3');
    expect(a.endsWith('.mp3')).toBe(true);
    expect(newFilename('.mp3')).not.toBe(a);
  });
});
