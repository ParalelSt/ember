import { describe, expect, it } from 'vitest';
import { canonicalId, exclusionKeys, identityKeys, isExcluded, MAX_EXCLUDE_KEYS } from './trackIdentity';
import type { Track } from '@/types/track';

const t = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  source: 'youtube',
  sourceId: id.split(':').pop() ?? id,
  title: `Title ${id}`,
  artist: 'Band',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
  ...over,
});

describe('canonicalId', () => {
  it('folds a doubled source prefix onto one', () => {
    expect(canonicalId('youtube:youtube:X59TlszGtfM')).toBe('youtube:X59TlszGtfM');
    expect(canonicalId('youtube:youtube:youtube:abc')).toBe('youtube:abc');
  });

  it('leaves a plain id as it is', () => {
    expect(canonicalId('youtube:X59TlszGtfM')).toBe('youtube:X59TlszGtfM');
    expect(canonicalId('upload:abc')).toBe('upload:abc');
    expect(canonicalId('abc')).toBe('abc');
  });
});

describe('identityKeys / isExcluded', () => {
  it('matches the same song whatever spelling its id has', () => {
    const inPlaylist = t('youtube:X59TlszGtfM', { title: "Don't Look Back in Anger", artist: 'Oasis' });
    const fromRadio = t('youtube:youtube:X59TlszGtfM', { title: 'Something else', artist: 'Other' });
    expect(isExcluded(fromRadio, new Set(exclusionKeys([inPlaylist])))).toBe(true);
  });

  it('matches by source id when the id itself differs', () => {
    const row = t('youtube:abc');
    const odd = { ...t('weird-id', { title: 'Other title', artist: 'Other' }), sourceId: 'abc' };
    expect(isExcluded(odd, new Set(exclusionKeys([row])))).toBe(true);
  });

  it('matches another upload of the same song (songKey)', () => {
    const row = t('youtube:aaa', { title: 'Wonderwall', artist: 'Oasis' });
    const video = t('youtube:bbb', { title: 'Wonderwall (Official Video)', artist: 'Oasis' });
    expect(isExcluded(video, new Set(exclusionKeys([row])))).toBe(true);
  });

  it('does not match a different song', () => {
    const row = t('youtube:aaa', { title: 'Wonderwall', artist: 'Oasis' });
    const other = t('youtube:ccc', { title: 'Champagne Supernova', artist: 'Oasis' });
    expect(isExcluded(other, new Set(exclusionKeys([row])))).toBe(false);
    expect(isExcluded(other, new Set())).toBe(false);
  });

  it('gives an id key and a song key', () => {
    expect(identityKeys(t('youtube:youtube:aaa'))).toEqual(expect.arrayContaining(['id:youtube:aaa']));
    expect(identityKeys(t('youtube:aaa')).some((k) => k.startsWith('song:'))).toBe(true);
  });
});

describe('exclusionKeys', () => {
  it('caps a list that will be stored', () => {
    const many = Array.from({ length: 5000 }, (_, i) => t(`youtube:v${i}`));
    expect(exclusionKeys(many, MAX_EXCLUDE_KEYS)).toHaveLength(MAX_EXCLUDE_KEYS);
    expect(exclusionKeys(many).length).toBeGreaterThan(MAX_EXCLUDE_KEYS);
  });
});
