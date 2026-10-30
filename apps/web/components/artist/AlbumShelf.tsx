'use client';

import { RowShelf } from '@/components/page/RowShelf';
import { CollectionCard } from '@/components/library/CollectionCard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { pickThumbnail } from '@/lib/artwork';
import type { AlbumSummary } from '@/types/track';

/** An artist's albums on Home's shelf: plain cover tiles linking to the
 *  album, every one of them in the row (no cap, no Show all). */
export function AlbumShelf({ title, albums }: { title: string; albums: AlbumSummary[] }) {
  const isDesktop = useIsDesktop();
  return (
    <RowShelf title={title} variant={isDesktop ? 'desktop' : 'phone'} limit={Infinity}>
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
