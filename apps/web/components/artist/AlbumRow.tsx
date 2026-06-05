'use client';

import type { AlbumSummary } from '@/types/track';
import { AlbumCard } from './AlbumCard';

interface Props {
  albums: AlbumSummary[];
}

export function AlbumRow({ albums }: Props) {
  if (!albums?.length) return null;
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
      {albums.map((a) => (
        <div key={a.browseId} className="snap-start">
          <AlbumCard album={a} />
        </div>
      ))}
    </div>
  );
}
