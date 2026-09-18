import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';

/** Shown while /artist/[id]'s own chunk and payload are loading, before the
 *  page even mounts (the page's own "Loading…" text covers the query after
 *  that). */
export default function ArtistLoading() {
  return <CollectionSkeleton variant="artist" />;
}
