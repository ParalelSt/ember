import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** Shown while /playlist/[id]'s own chunk and payload are loading, before
 *  the page even mounts (the page's own "Loading…" text covers the query
 *  after that). */
function NewPlaylistLoading() {
  return <CollectionSkeleton variant="collection" />;
}

/** The new look's loading, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function PlaylistLoading() {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/playlist/[id]/loading');
    return <Legacy />;
  }
  return NewPlaylistLoading();
}
