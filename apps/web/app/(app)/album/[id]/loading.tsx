import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';

/** Shown while /album/[id]'s own chunk and payload are loading, before the
 *  page even mounts (the page's own "Loading…" text covers the query after
 *  that). */
export default function AlbumLoading() {
  return <CollectionSkeleton variant="album" />;
}
