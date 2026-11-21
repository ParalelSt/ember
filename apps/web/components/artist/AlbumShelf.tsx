'use client';

import { RowShelf } from '@/components/page/RowShelf';
import { CollectionCard } from '@/components/library/CollectionCard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { pickThumbnail } from '@/lib/artwork';
import type { AlbumSummary } from '@/types/track';

/** An artist's albums on Home's shelf: plain cover tiles linking to the
 *  album, whole cards only inside a RowNavProvider with fit (Show all opens `showAllHref`). */
export function AlbumShelf({ title, albums, showAllHref }: { title: string; albums: AlbumSummary[]; showAllHref?: string }) {
  const isDesktop = useIsDesktop();
  return (
    <RowShelf title={title} variant={isDesktop ? 'desktop' : 'phone'} limit={Infinity} showAllHref={showAllHref}>
      {albums.map((a) => (
        <CollectionCard
          key={a.browseId}
          variant={isDesktop ? 'tile-lg' : 'tile'}
          title={a.title}
          subtitle={a.year ? String(a.year) : ''}
          href={`/album/${encodeURIComponent(a.browseId)}`}
          cover={{ src: pickThumbnail(a.thumbnails), icon: null, fallback: 'card' }}
        />
      ))}
    </RowShelf>
  );
}
