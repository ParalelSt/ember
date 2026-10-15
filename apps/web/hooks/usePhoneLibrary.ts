'use client';

import { useMemo } from 'react';
import { useCollections } from '@/hooks/useCollections';
import { useQueryHistory, useQueryLikes, useQueryUploads } from '@/hooks/useLibrary';
import { useNavPlaylists } from '@/hooks/useNavPlaylists';
import { buildLibraryItems, type LibraryItem } from '@/lib/library';

export interface UsePhoneLibraryResult {
  /** Every item, system collections first, playlists in Recents order. */
  items: LibraryItem[];
  hasPlaylists: boolean;
  /** A playlist was opened from the Library: it moves up Recents. */
  onOpenPlaylist: (id: string) => void;
}

/** The phone Library's data: the library queries, the offline store's
 *  downloads and the nav's own order (pinned first, then last opened, the
 *  same Recents the Sidebar and Drawer show), assembled by lib/library. */
export function usePhoneLibrary(): UsePhoneLibraryResult {
  const { playlists, downloadedIds } = useCollections();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: uploads = [] } = useQueryUploads();
  const navItems = useMemo(() => playlists.map((p) => ({ ...p, id: p.pinId })), [playlists]);
  const nav = useNavPlaylists(navItems);

  const items = useMemo(
    () => buildLibraryItems({ liked, history, uploads, playlists: nav.items, downloadedIds }),
    [liked, history, uploads, nav.items, downloadedIds],
  );
  return { items, hasPlaylists: playlists.length > 0, onOpenPlaylist: nav.onOpen };
}
