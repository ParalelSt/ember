'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { logger } from '@/lib/logger/client';
import type { Playlist, Track } from '@/types/track';

export const QK = {
  likes: ['likes'] as const,
  history: ['history'] as const,
  playlists: ['playlists'] as const,
  playlist: (id: string) => ['playlist', id] as const,
  trending: ['trending'] as const,
  recommended: (seed: string | undefined) => ['recommended', seed ?? null] as const,
  artist: (id: string) => ['artist', id] as const,
  search: (q: string) => ['search', q] as const,
};

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
    onSettled: () => qc.invalidateQueries({ queryKey: QK.likes }),
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
      return { prev, id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev && ctx?.id) qc.setQueryData(QK.playlist(ctx.id), ctx.prev);
    },
  });
}
