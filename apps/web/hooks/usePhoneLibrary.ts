'use client';

import { useMemo, useRef } from 'react';
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
 *  downloads and the nav's own order (pinned first, then last opened, held
 *  while the page is open), assembled by lib/library. */
export function usePhoneLibrary(): UsePhoneLibraryResult {
  const { playlists, downloadedIds } = useCollections();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: uploads = [] } = useQueryUploads();
  const navItems = useMemo(() => playlists.map((p) => ({ ...p, id: p.pinId })), [playlists]);
  const nav = useNavPlaylists(navItems, { byOpened: true });

  // Recents is sorted by last opened, but must not reorder while the page is
  // open (a refetch, or opening a playlist from here). The order is taken once
  // the saved times have loaded and kept until the next visit; playlists that
  // appear meanwhile go on top, ones that leave drop out.
  const held = useRef<string[] | null>(null);
  const playlistsHeld = useMemo(() => {
    if (!nav.ready || nav.items.length === 0) return nav.items;
    const here = new Map(nav.items.map((p) => [p.id, p] as const));
    if (held.current === null) {
      held.current = nav.items.map((p) => p.id);
    } else {
      const seen = new Set(held.current);
      const fresh = nav.items.filter((p) => !seen.has(p.id)).map((p) => p.id);
      held.current = [...fresh, ...held.current.filter((id) => here.has(id))];
    }
    return held.current.map((id) => here.get(id)!);
  }, [nav.items, nav.ready]);

  const items = useMemo(
    () => buildLibraryItems({ liked, history, uploads, playlists: playlistsHeld, downloadedIds }),
    [liked, history, uploads, playlistsHeld, downloadedIds],
  );
  return { items, hasPlaylists: playlists.length > 0, onOpenPlaylist: nav.onOpen };
}
