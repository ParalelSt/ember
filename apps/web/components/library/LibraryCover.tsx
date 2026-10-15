import { LikedSongsCover } from '@/components/library/LikedSongsCover';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { badgeCoverLook, type LibraryCoverSpec } from '@/lib/library';
import { LIBRARY_BADGES, LIBRARY_BADGE_FOREGROUND } from '@/components/library/libraryIcons';
import { cn } from '@/lib/utils';

export interface LibraryCoverProps {
  cover: LibraryCoverSpec;
  /** Size and rounding: `size-14 rounded-[6px]` for a row, `w-full rounded-[8px]` for a tile. */
  className?: string;
}

/** Presentational only: one phone Library item's art. Liked songs keeps its
 *  sound-wave heart; Recently played, Uploads and Downloaded are a 2x2
 *  mosaic of their own song covers with a small round coloured badge in the
 *  bottom-right corner (the icon map is components/library/libraryIcons), falling back to
 *  one cover with the badge, or a plain coloured tile with the glyph, when
 *  there are fewer songs; a playlist is its cover or its song mosaic. */
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
  const badge = LIBRARY_BADGES[cover.badge];
  const Icon = badge.icon;
  const look = badgeCoverLook(cover.arts);
  return (
    <div
      data-library-cover={cover.badge}
      data-look={look.mode}
      className={cn('relative aspect-square overflow-hidden bg-secondary', className)}
      style={look.mode === 'plain' ? { background: badge.tile } : undefined}
    >
      {look.mode === 'mosaic' && (
        <div data-mosaic className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          {look.tiles.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ))}
        </div>
      )}
      {look.mode === 'single' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={look.src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {look.mode === 'plain' ? (
        <span data-glyph className="absolute inset-0 grid place-items-center" style={{ color: LIBRARY_BADGE_FOREGROUND }}>
          <Icon aria-hidden className="size-[42%]" />
        </span>
      ) : (
        <span
          data-badge
          className="absolute right-[6%] bottom-[6%] grid aspect-square w-[34%] place-items-center rounded-full shadow-soft"
          style={{ background: badge.color, color: LIBRARY_BADGE_FOREGROUND }}
        >
          <Icon aria-hidden className="size-[60%]" />
        </span>
      )}
    </div>
  );
}
