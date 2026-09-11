import { describe, expect, it } from 'vitest';
import {
  contextFor,
  countLabel,
  hrefFor,
  iconFor,
  pinIdFor,
  refFromPinId,
  sameContext,
  systemCollections,
  titleFor,
  toSummary,
} from './collections';

describe('hrefFor', () => {
  it('routes each of the four kinds', () => {
    expect(hrefFor({ kind: 'playlist', id: 'abc' })).toBe('/playlist/abc');
    expect(hrefFor({ kind: 'liked' })).toBe('/library/liked');
    expect(hrefFor({ kind: 'recent' })).toBe('/library/recent');
    expect(hrefFor({ kind: 'uploads' })).toBe('/library/uploads');
  });
});

describe('pinIdFor / refFromPinId', () => {
  it('round-trips every kind', () => {
    const refs = [
      { kind: 'playlist', id: 'abc' },
      { kind: 'liked' },
      { kind: 'recent' },
      { kind: 'uploads' },
    ] as const;
    for (const ref of refs) {
      expect(refFromPinId(pinIdFor(ref))).toEqual(ref);
    }
  });

  it('defaults an unrecognized pin id to a playlist', () => {
    expect(refFromPinId('zzz')).toEqual({ kind: 'playlist', id: 'zzz' });
  });
});

describe('titleFor', () => {
  it('returns the system title, or a playlist name (falling back to Playlist)', () => {
    expect(titleFor({ kind: 'liked' })).toBe('Liked songs');
    expect(titleFor({ kind: 'recent' })).toBe('Recently played');
    expect(titleFor({ kind: 'uploads' })).toBe('Uploads');
    expect(titleFor({ kind: 'playlist', id: 'abc' }, 'Road trip')).toBe('Road trip');
    expect(titleFor({ kind: 'playlist', id: 'abc' })).toBe('Playlist');
  });
});

describe('iconFor', () => {
  it('returns the system icon, or null for a playlist', () => {
    expect(iconFor({ kind: 'liked' })).toBe('heart');
    expect(iconFor({ kind: 'recent' })).toBe('clock');
    expect(iconFor({ kind: 'uploads' })).toBe('upload');
    expect(iconFor({ kind: 'playlist', id: 'abc' })).toBe(null);
  });
});

describe('contextFor', () => {
  it('maps each kind to its PlaybackContext', () => {
    expect(contextFor({ kind: 'liked' })).toEqual({ type: 'liked' });
    expect(contextFor({ kind: 'recent' })).toEqual({ type: 'history' });
    expect(contextFor({ kind: 'uploads' })).toEqual({ type: 'uploads' });
    expect(contextFor({ kind: 'playlist', id: 'abc' }, 'Road trip')).toEqual({
      type: 'playlist',
      playlistId: 'abc',
      playlistName: 'Road trip',
    });
  });
});

describe('sameContext', () => {
  it('identifies matching and non-matching collections', () => {
    const liked1 = { type: 'liked' } as const;
    const liked2 = { type: 'liked' } as const;
    const history = { type: 'history' } as const;
    const playlist1 = { type: 'playlist', playlistId: 'abc', playlistName: 'Road trip' } as const;
    const playlist2 = { type: 'playlist', playlistId: 'abc', playlistName: 'Road trip' } as const;
    const playlist3 = { type: 'playlist', playlistId: 'xyz', playlistName: 'Other' } as const;

    expect(sameContext(liked1, liked2)).toBe(true);
    expect(sameContext(playlist1, playlist2)).toBe(true);
    expect(sameContext(playlist1, playlist3)).toBe(false);
    expect(sameContext(liked1, history)).toBe(false);
    expect(sameContext(null, liked1)).toBe(false);
    expect(sameContext(liked1, undefined)).toBe(false);
    expect(sameContext(null, undefined)).toBe(false);
  });
});

describe('countLabel', () => {
  it('pluralizes with the default or a given noun', () => {
    expect(countLabel(1)).toBe('1 song');
    expect(countLabel(7)).toBe('7 songs');
    expect(countLabel(2, 'track')).toBe('2 tracks');
  });
});

describe('systemCollections', () => {
  it('lists liked, recent, uploads in that order', () => {
    const sys = systemCollections();
    expect(sys).toHaveLength(3);
    expect(sys[0]).toEqual({ ref: { kind: 'liked' }, title: 'Liked songs', href: '/library/liked', pinId: 'liked', icon: 'heart' });
    expect(sys[1]).toEqual({ ref: { kind: 'recent' }, title: 'Recently played', href: '/library/recent', pinId: 'recent', icon: 'clock' });
    expect(sys[2]).toEqual({ ref: { kind: 'uploads' }, title: 'Uploads', href: '/library/uploads', pinId: 'uploads', icon: 'upload' });
  });
});

describe('toSummary', () => {
  it('gives a system collection a count subtitle', () => {
    const summary = toSummary({ kind: 'liked' }, { count: 3 });
    expect(summary).toEqual({
      ref: { kind: 'liked' },
      title: 'Liked songs',
      subtitle: '3 songs',
      href: '/library/liked',
      pinId: 'liked',
      icon: 'heart',
      artworkUrl: null,
      downloaded: false,
    });
  });

  it('defaults a system collection with no count to zero songs', () => {
    expect(toSummary({ kind: 'recent' }).subtitle).toBe('0 songs');
  });

  it('gives a playlist its name, artwork and a Playlist subtitle', () => {
    const summary = toSummary(
      { kind: 'playlist', id: 'p1' },
      { name: 'Road Trip', artworkUrl: 'https://example.com/art.jpg' },
    );
    expect(summary).toEqual({
      ref: { kind: 'playlist', id: 'p1' },
      title: 'Road Trip',
      subtitle: 'Playlist',
      href: '/playlist/p1',
      pinId: 'p1',
      icon: null,
      artworkUrl: 'https://example.com/art.jpg',
      downloaded: false,
    });
  });

  it('flips a playlist subtitle to Downloaded when pinned', () => {
    const summary = toSummary({ kind: 'playlist', id: 'p1' }, { name: 'Road Trip', downloaded: true });
    expect(summary.subtitle).toBe('Downloaded');
    expect(summary.downloaded).toBe(true);
  });

  it('does not change a system collection subtitle when downloaded (only the badge cares)', () => {
    const summary = toSummary({ kind: 'liked' }, { count: 5, downloaded: true });
    expect(summary.subtitle).toBe('5 songs');
    expect(summary.downloaded).toBe(true);
  });
});
