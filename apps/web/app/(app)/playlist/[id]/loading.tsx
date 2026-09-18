import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';

/** Shown while /playlist/[id]'s own chunk and payload are loading, before
 *  the page even mounts (the page's own "Loading…" text covers the query
 *  after that). */
export default function PlaylistLoading() {
  return <CollectionSkeleton variant="collection" />;
}
