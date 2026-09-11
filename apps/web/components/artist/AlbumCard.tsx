'use client';

import Link from 'next/link';
import { Artwork } from '@/components/primitives/Artwork';
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
      <Artwork
        src={cover}
        loading="lazy"
        className="aspect-square w-full rounded-lg bg-black shadow-soft"
      />
      <div className="mt-3 truncate text-sm font-semibold">{album.title}</div>
      {year && <div className="mt-1 text-xs text-muted-foreground">{year}</div>}
    </Link>
  );
}
