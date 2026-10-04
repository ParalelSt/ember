/** A collaborative playlist's poll that fails once (the host restarting,
 *  a 502) must not end the page: React Query keeps the songs it had and
 *  only a 404 (deleted, or you were removed) means the playlist is gone. */
import { describe, expect, it } from 'vitest';
import { isPlaylistGone, playlistPollMs, COLLAB_POLL_MS } from './useLibrary';

const shared = { playlist: { collaborative: true } } as never;
const err = (status: number) => Object.assign(new Error('x'), { status });

describe('a collaborative playlist poll that fails', () => {
  it('keeps polling after a passing failure', () => {
    expect(playlistPollMs({ status: 'error', data: shared, error: err(502) })).toBe(COLLAB_POLL_MS);
    expect(playlistPollMs({ status: 'error', data: shared, error: new TypeError('Failed to fetch') })).toBe(COLLAB_POLL_MS);
  });

  it('stops once the playlist is gone', () => {
    expect(playlistPollMs({ status: 'error', data: shared, error: err(404) })).toBe(false);
  });

  it('only a 404 or 403 reads as gone; a 502 does not', () => {
    expect(isPlaylistGone(err(404))).toBe(true);
    expect(isPlaylistGone(err(403))).toBe(true);
    expect(isPlaylistGone(err(502))).toBe(false);
    expect(isPlaylistGone(null)).toBe(false);
  });

  it('does not poll a playlist that is not shared', () => {
    expect(playlistPollMs({ status: 'success', data: { playlist: { collaborative: false } } as never, error: null })).toBe(false);
  });
});
