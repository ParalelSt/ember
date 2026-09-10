'use client';

import { useMemo } from 'react';
import { useQueryHistory, useQueryLikes, useQueryPlaylists, useQueryUploads } from '@/hooks/useLibrary';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { SYSTEM_COLLECTIONS, toSummary, type CollectionSummary, type SystemKind } from '@/lib/collections';

export interface UseCollectionsResult {
  system: CollectionSummary[];
  playlists: CollectionSummary[];
  downloadedIds: Set<string>;
  isLoading: boolean;
}

/** Composes the four library queries plus the offline store into the two
 *  shelves the Library page (online branch), Sidebar and Drawer all need,
 *  so none of them assembles CollectionSummary by hand. */
export function useCollections(): UseCollectionsResult {
  const { data: liked = [], isLoading: likedLoading } = useQueryLikes();
  const { data: history = [], isLoading: historyLoading } = useQueryHistory();
  const { data: uploads = [], isLoading: uploadsLoading } = useQueryUploads();
  const { data: playlistData = [], isLoading: playlistsLoading } = useQueryPlaylists();
  const downloaded = useOfflineStore((s) => s.downloaded);

  const downloadedIds = useMemo(() => new Set(downloaded), [downloaded]);

  const counts: Record<SystemKind, number> = {
    liked: liked.length,
    recent: history.length,
    uploads: uploads.length,
  };

  const system = useMemo(
    () =>
      SYSTEM_COLLECTIONS.map((kind) =>
        toSummary({ kind }, { count: counts[kind], downloaded: downloadedIds.has(kind) }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counts is a fresh object each render; its values are the real deps.
    [counts.liked, counts.recent, counts.uploads, downloadedIds],
  );

  const playlists = useMemo(
    () =>
      playlistData.map((p) =>
        toSummary(
          { kind: 'playlist', id: p.id },
          { name: p.name, artworkUrl: p.artwork_url, downloaded: downloadedIds.has(p.id) },
        ),
      ),
    [playlistData, downloadedIds],
  );

  return {
    system,
    playlists,
    downloadedIds,
    isLoading: likedLoading || historyLoading || uploadsLoading || playlistsLoading,
  };
}
