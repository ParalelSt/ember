import { describe, expect, it } from 'vitest';
import { contextTitle } from './contextTitle';

describe('contextTitle', () => {
  it('names a playlist, an album and an artist with their kind', () => {
    expect(contextTitle({ type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' })).toEqual({
      kicker: 'Playing from playlist',
      name: 'Road trip',
    });
    expect(contextTitle({ type: 'album', albumId: 'a1', albumTitle: 'Blue' })).toEqual({ kicker: 'Playing from album', name: 'Blue' });
    expect(contextTitle({ type: 'artist', artistName: 'Baccara' })).toEqual({ kicker: 'Playing from artist', name: 'Baccara' });
  });

  it('names the library lists and radio', () => {
    expect(contextTitle({ type: 'liked' }).name).toBe('Liked songs');
    expect(contextTitle({ type: 'history' }).name).toBe('Recently played');
    expect(contextTitle({ type: 'uploads' }).name).toBe('Uploads');
    expect(contextTitle({ type: 'radio' })).toEqual({ kicker: 'Playing from', name: 'Radio' });
  });

  it('quotes the search, and says only "search" without one', () => {
    expect(contextTitle({ type: 'search', query: ' boogie ' })).toEqual({ kicker: 'Playing from search', name: '"boogie"' });
    expect(contextTitle({ type: 'search' })).toEqual({ kicker: 'Playing from search', name: null });
  });

  it('falls back to "Now playing" for a lone song or no context', () => {
    expect(contextTitle({ type: 'single' })).toEqual({ kicker: 'Now playing', name: null });
    expect(contextTitle(null)).toEqual({ kicker: 'Now playing', name: null });
  });
});
