import { describe, expect, it } from 'vitest';
import { toSummary } from './collections';

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
