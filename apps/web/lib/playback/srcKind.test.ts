import { describe, expect, it } from 'vitest';
import { mediaSrcKind } from './srcKind';

describe('mediaSrcKind', () => {
  it.each([
    ['https://ember.example/api/radio/stream/f468711f-a403-11e8-abb8-52543be04c81', 'station'],
    ['/api/youtube/stream/NxvzO45X8I8', 'youtube'],
    ['https://ember.example/api/youtube/stream/NxvzO45X8I8?retry=1', 'youtube'],
    ['/api/uploads/abc123/stream', 'upload'],
    ['blob:https://ember.example/0a1b2c3d', 'cached'],
    ['https://localhost/_capacitor_file_/data/user/0/app.ember.music/files/a.m4a', 'local'],
    ['file:///data/a.m4a', 'local'],
    ['http://asset.localhost/Users/x/Music/a.m4a', 'local'],
    ['https://cdn.example/a.mp3', 'other'],
    ['', 'none'],
    [null, 'none'],
  ])('%s is %s', (src, kind) => {
    expect(mediaSrcKind(src)).toBe(kind);
  });
});
