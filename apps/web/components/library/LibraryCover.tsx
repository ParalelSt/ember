import { LikedSongsCover } from '@/components/library/LikedSongsCover';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import type { LibraryCoverSpec } from '@/lib/library';
import { GlyphTile } from '@/components/library/GlyphTile';
import { LIBRARY_BADGES } from '@/components/library/libraryIcons';
import { cn } from '@/lib/utils';

export interface LibraryCoverProps {
  cover: LibraryCoverSpec;
  /** Size and rounding: `size-14 rounded-[6px]` for a row, `w-full rounded-[8px]` for a tile. */
  className?: string;
}

/** Presentational only: one phone Library item's art. Liked songs keeps its
 *  white heart on the violet gradient; Recently played, Uploads and
 *  Downloaded are each their own gradient with a clear white glyph (the map
 *  is components/library/libraryIcons); a playlist is its cover, its song
 *  mosaic, or the neutral music-note tile. */
export function LibraryCover({ cover, className }: LibraryCoverProps) {
  if (cover.kind === 'liked') {
    return (
      <div data-library-cover="liked" className={cn('relative aspect-square overflow-hidden', className)}>
        <LikedSongsCover className="absolute inset-0" />
      </div>
    );
  }
  if (cover.kind === 'art') {
    return (
      <CollectionCover
        src={cover.src}
        icon={null}
        mosaic={cover.mosaic}
        className={cn('shadow-none', className)}
      />
    );
  }
  const look = LIBRARY_BADGES[cover.badge];
  return (
    <div data-library-cover={cover.badge} className={cn('relative aspect-square overflow-hidden', className)}>
      <GlyphTile background={look.tile} icon={look.icon} className="absolute inset-0" />
    </div>
  );
}
