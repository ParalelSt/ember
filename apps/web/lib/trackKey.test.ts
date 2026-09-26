import { describe, expect, it } from 'vitest';
import { parseTrackKey } from './trackKey';

describe('parseTrackKey', () => {
  it('reads YouTube and upload ids', () => {
    expect(parseTrackKey('youtube:abc_DEF-1')).toEqual({ source: 'youtube', sourceId: 'abc_DEF-1', key: 'youtube-abc_DEF-1' });
    expect(parseTrackKey('upload:x1')).toEqual({ source: 'upload', sourceId: 'x1', key: 'upload-x1' });
  });

  it('refuses other sources, empty ids and anything that could leave a directory', () => {
    expect(parseTrackKey('spotify:abc')).toBeNull();
    expect(parseTrackKey('youtube:')).toBeNull();
    expect(parseTrackKey(':abc')).toBeNull();
    expect(parseTrackKey('youtube:../../etc')).toBeNull();
    expect(parseTrackKey('upload:a/b')).toBeNull();
    expect(parseTrackKey(`youtube:${'a'.repeat(33)}`)).toBeNull();
  });
});
