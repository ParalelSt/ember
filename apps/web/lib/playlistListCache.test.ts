// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/upsertTrack', () => ({ upsertTrack: async () => 'tr0000000000001' }));

const {
  PLAYLIST_LIST_MAX_USERS,
  PLAYLIST_LIST_TTL_MS,
  _resetPlaylistListCache,
  cachedPlaylistList,
  changesPlaylists,
  playlistListGeneration,
  playlistsChanged,
  rememberPlaylistList,
} = await import('./playlistListCache');

beforeEach(() => _resetPlaylistListCache());

describe('playlistListCache', () => {
  it('keeps an answer per person for the TTL', () => {
    rememberPlaylistList('u1', playlistListGeneration(), ['a'], 1_000);
    expect(cachedPlaylistList('u1', 1_000 + PLAYLIST_LIST_TTL_MS - 1)).toEqual(['a']);
    expect(cachedPlaylistList('u2', 1_000)).toBeNull();
    expect(cachedPlaylistList('u1', 1_000 + PLAYLIST_LIST_TTL_MS)).toBeNull();
  });

  it('forgets everything on a change, and refuses an answer read across one', () => {
    const gen = playlistListGeneration();
    rememberPlaylistList('u1', gen, ['a']);
    playlistsChanged();
    expect(cachedPlaylistList('u1')).toBeNull();
    rememberPlaylistList('u1', gen, ['stale']);
    expect(cachedPlaylistList('u1')).toBeNull();
  });

  it('stays bounded, dropping the oldest person first', () => {
    const gen = playlistListGeneration();
    for (let i = 0; i <= PLAYLIST_LIST_MAX_USERS; i++) rememberPlaylistList(`u${i}`, gen, [i]);
    expect(cachedPlaylistList('u0')).toBeNull();
    expect(cachedPlaylistList(`u${PLAYLIST_LIST_MAX_USERS}`)).toEqual([PLAYLIST_LIST_MAX_USERS]);
  });

  it('counts only writes to the routes that touch playlists', () => {
    expect(changesPlaylists('playlists/[id]/tracks', 'POST')).toBe(true);
    expect(changesPlaylists('playlists', 'GET')).toBe(false);
    expect(changesPlaylists('admin/users/[id]', 'DELETE')).toBe(true);
    expect(changesPlaylists('sessions/[id]/save', 'POST')).toBe(true);
    expect(changesPlaylists('sessions/[id]/play', 'POST')).toBe(false);
    expect(changesPlaylists('likes', 'POST')).toBe(false);
    expect(changesPlaylists('playlistsx', 'POST')).toBe(false);
  });

  it('the import runner forgets them for every song it adds, added or already there', async () => {
    const { addTrackAt } = await import('./import/store');
    const create = vi.fn(async () => ({}));
    const pb = { collection: () => ({ create }) } as never;
    const before = playlistListGeneration();
    await addTrackAt(pb, 'pl0000000000001', 1, {} as never);
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { status: 400 }));
    await addTrackAt(pb, 'pl0000000000001', 2, {} as never);
    expect(playlistListGeneration()).toBe(before + 2);
  });
});
