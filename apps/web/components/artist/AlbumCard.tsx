'use client';

import Link from 'next/link';
import type { AlbumSummary } from '@/types/track';
import { pickThumbnail } from '@/lib/artwork';
import { cn } from '@/lib/utils';

interface Props {
  album: AlbumSummary;
  className?: string;
}

export function AlbumCard({ album, className }: Props) {
  const cover = pickThumbnail(album.thumbnails);
  const year = album.year ? String(album.year) : null;

  return (
    <Link
      href={`/album/${encodeURIComponent(album.browseId)}`}
      className={cn(
        'group block p-3 rounded-xl bg-card hover:bg-card/80 transition-colors w-40 shrink-0',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black shadow-soft">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="mt-3 truncate text-sm font-semibold">{album.title}</div>
      {year && <div className="mt-1 text-xs text-muted-foreground">{year}</div>}
    </Link>
  );
}
