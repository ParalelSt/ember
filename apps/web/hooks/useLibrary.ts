'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { logger } from '@/lib/logger/client';
import { LIKED_PIN, RECENT_PIN, pinLiked, pinList, playableFor } from '@/lib/offline';
import { nativeOfflinePresent } from '@/lib/offlineNative';
import type { Playlist, Track } from '@/types/track';

export const QK = {
  likes: ['likes'] as const,
  history: ['history'] as const,
  playlists: ['playlists'] as const,
  playlist: (id: string) => ['playlist', id] as const,
  trending: ['trending'] as const,
  recommended: (seed: string | undefined) => ['recommended', seed ?? null] as const,
  artist: (id: string) => ['artist', id] as const,
  album: (id: string) => ['album', id] as const,
  track: (videoId: string) => ['track', videoId] as const,
  search: (q: string) => ['search', q] as const,
  uploads: ['uploads'] as const,
};

/** Every song members have uploaded to this server — a shared library, not
 *  a per-user one. */
export function useQueryUploads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: QK.uploads,
    queryFn: () => api.listUploads().then((r) => r.tracks),
    enabled: !!user,
  });
}

export function useQueryLikes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: QK.likes,
    queryFn: () => api.listLikes().then((r) => r.tracks),
    enabled: !!user,
  });
}

export function useQueryHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: QK.history,
    queryFn: () => api.getHistory().then((r) => r.tracks),
    enabled: !!user,
  });
}

export function useQueryPlaylists() {
  const { user } = useAuth();
  return useQuery({
    queryKey: QK.playlists,
    queryFn: () => api.listPlaylists().then((r) => r.playlists),
    enabled: !!user,
  });
}

export function useQueryPlaylist(id: string) {
  return useQuery({
    queryKey: QK.playlist(id),
    queryFn: () => api.getPlaylist(id),
  });
}

export function useQueryTrending() {
  return useQuery({
    queryKey: QK.trending,
    queryFn: () => api.getTrending().then((r) => r.tracks),
    staleTime: 5 * 60_000,
  });
}

export function useQueryRecommended(seed: string | undefined) {
  return useQuery({
    queryKey: QK.recommended(seed),
    queryFn: () => api.getRecommended(seed).then((r) => r.tracks),
  });
}

export function useQueryArtist(id: string) {
  return useQuery({
    queryKey: QK.artist(id),
    queryFn: () => api.getArtist(id),
    enabled: !!id,
  });
}

export function useQueryAlbum(id: string | null | undefined) {
  return useQuery({
    queryKey: QK.album(id ?? ''),
    queryFn: () => api.getAlbum(id!),
    enabled: !!id,
    staleTime: 60 * 60_000,
  });
}

export function useQueryTrack(videoId: string | null | undefined) {
  return useQuery({
    queryKey: QK.track(videoId ?? ''),
    queryFn: () => api.getTrack(videoId!).then((r) => r.track),
    enabled: !!videoId,
    staleTime: 60 * 60_000,
  });
}

/** Same tracks, order ignored: pins carry the list the native side stored, and
 *  the query cache reorders on every like. */
function sameTrackIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

export function useExecuteToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ track, wasLiked }: { track: Track; wasLiked: boolean }) =>
      wasLiked ? api.unlike(track.id) : api.like(track),
    onMutate: async ({ track, wasLiked }) => {
      await qc.cancelQueries({ queryKey: QK.likes });
      const prev = qc.getQueryData<Track[]>(QK.likes) ?? [];
      const next = wasLiked ? prev.filter((t) => t.id !== track.id) : [track, ...prev];
      qc.setQueryData(QK.likes, next);
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QK.likes, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QK.likes });
      // Liked songs are pinned for offline: keep the native download synced
      // with every like/unlike so it never drifts (re-pin only downloads
      // what's missing and drops what's no longer liked).
      if (!nativeOfflinePresent()) return;
      const pin = useOfflineStore.getState().pins.find((p) => p.id === LIKED_PIN);
      if (!pin) return;
      const likes = qc.getQueryData<Track[]>(QK.likes) ?? [];
      // A re-pin restarts the download service, which flashes its "Preparing
      // downloads" notification even when there is nothing to do. onSettled
      // fires after the invalidated refetch too, so skip the call whenever the
      // pinned set already matches.
      // Compare against the playable set: pinList drops unavailable tracks,
      // so the raw likes would never match once one liked song is dead.
      if (sameTrackIds(pin.trackIds, playableFor(likes).map((t) => t.id))) return;
      void pinLiked(likes);
    },
  });
}

export function useExecuteRecordPlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (track: Track) => api.recordPlay(track),
    onMutate: async (track) => {
      await qc.cancelQueries({ queryKey: QK.history });
      const prev = qc.getQueryData<Track[]>(QK.history) ?? [];
      const next = [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 50);
      qc.setQueryData(QK.history, next);
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(QK.history, ctx.prev);
    },
    onSettled: () => {
      // Recently played is pinned for offline the same way Liked is: keep the
      // native download synced with every play so its download button doesn't
      // sit on "Update download" after every song (same drift-avoidance guard
      // as useExecuteToggleLike, mirrored here for history).
      if (!nativeOfflinePresent()) return;
      const pin = useOfflineStore.getState().pins.find((p) => p.id === RECENT_PIN);
      if (!pin) return;
      const history = qc.getQueryData<Track[]>(QK.history) ?? [];
      if (sameTrackIds(pin.trackIds, playableFor(history).map((t) => t.id))) return;
      void pinList(RECENT_PIN, 'Recently played', history);
    },
  });
}

export function useExecuteCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createPlaylist(name).then((r) => r.playlist),
    onSuccess: (playlist) => {
      const prev = qc.getQueryData<Playlist[]>(QK.playlists) ?? [];
      qc.setQueryData(QK.playlists, [playlist, ...prev]);
      logger.breadcrumb('library', 'playlist.create', { id: playlist.id, name: playlist.name });
    },
  });
}

export function useExecuteDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: QK.playlists });
      logger.breadcrumb('library', 'playlist.delete', { id });
    },
  });
}

export function useExecuteAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, track }: { id: string; track: Track }) => api.addToPlaylist(id, track),
    onSuccess: (_d, { id, track }) => {
      qc.invalidateQueries({ queryKey: QK.playlist(id) });
      logger.breadcrumb('library', 'playlist.add', { playlistId: id, trackId: track.id });
    },
  });
}

export function useExecuteUpdatePlaylistArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.updatePlaylistArtwork(id, file),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: QK.playlist(id) });
      qc.invalidateQueries({ queryKey: QK.playlists });
    },
  });
}

export function useExecuteRemoveFromPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackId }: { id: string; trackId: string }) => api.removeFromPlaylist(id, trackId),
    onMutate: async ({ id, trackId }) => {
      await qc.cancelQueries({ queryKey: QK.playlist(id) });
      const prev = qc.getQueryData<{ tracks: Track[]; playlist: Playlist }>(QK.playlist(id));
      if (prev) {
        qc.setQueryData(QK.playlist(id), { ...prev, tracks: prev.tracks.filter((t) => t.id !== trackId) });
      }
      // If this playlist is what's CURRENTLY playing, drop the track from the
      // live player queue too — the queue is a snapshot, so without this the
      // removed song still plays when its turn comes (until a refresh).
      const s = usePlayerStore.getState();
      if (s.context?.type === 'playlist' && s.context.playlistId === id) {
        const removeIdx = s.queue.findIndex((t) => t.id === trackId);
        if (removeIdx >= 0) {
          const queue = s.queue.filter((_, i) => i !== removeIdx);
          let index = s.index;
          if (removeIdx < index) index -= 1;
          // Removing the playing track itself: index now points at the next
          // song and the player's id-effect advances to it automatically.
          if (index > queue.length - 1) index = queue.length - 1;
          usePlayerStore.setState({ queue, index });
        }
      }
      return { prev, id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev && ctx?.id) qc.setQueryData(QK.playlist(ctx.id), ctx.prev);
    },
  });
}

export function useExecuteReplaceInPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackId, track }: { id: string; trackId: string; track: Track }) =>
      api.replaceInPlaylist(id, trackId, track),
    onSuccess: (_d, { id, trackId, track }) => {
      qc.invalidateQueries({ queryKey: QK.playlist(id) });
      logger.breadcrumb('library', 'playlist.replace', { playlistId: id, from: trackId, to: track.id });
    },
  });
}

/** Swap a dead track for a live one in Likes: like the replacement first
 *  (so it's never briefly missing), then unlike the old one. */
export function useExecuteReplaceLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldId, track }: { oldId: string; track: Track }) => {
      await api.like(track);
      await api.unlike(oldId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.likes }),
  });
}
