import { Fragment, type ReactNode } from 'react';
import { CollectionCover, type CollectionCoverProps } from '@/components/library/CollectionCover';
import { Eyebrow } from '@/components/page/Eyebrow';
import { cn } from '@/lib/utils';

export type CollectionHeaderVariant = 'collection' | 'album' | 'artist';

// Every page family shipped its own hero geometry, so the variant keeps the
// exact cover size, radius and text-column behaviour each one had:
// collection (playlists, Liked, Recent, Uploads) 176 -> 192px rounded card,
// album (and the track page) 176 -> 224px, artist 144 -> 176px circle.
const VARIANTS: Record<CollectionHeaderVariant, { cover: string; radius: string; text: string }> = {
  collection: { cover: 'size-art-hero md:size-art-lg', radius: 'rounded-2xl', text: '' },
  album: { cover: 'size-art-hero md:size-art-xl', radius: 'rounded-md', text: 'min-w-0' },
  artist: { cover: 'size-art-hero-sm md:size-art-hero', radius: 'rounded-full', text: '' },
};

export interface CollectionHeaderProps {
  eyebrow: string;
  title: string;
  /** Joined with " · ". Nodes are allowed so a page can link the artist. */
  meta: ReactNode[];
  cover: CollectionCoverProps;
  variant?: CollectionHeaderVariant;
  onCoverClick?: () => void;
  coverLabel?: string;
  coverBusy?: boolean;
  /** Block under the meta line (the artist page's bio paragraph). */
  description?: ReactNode;
  children?: ReactNode;
}

/** Presentational only: a collection's title block, shared by the playlist
 *  page, Liked/Recent/Uploads, and the album, artist and track heroes.
 *  `children` is the action bar, which sits beside the cover on desktop
 *  (md:flex-row items-end). */
export function CollectionHeader({
  eyebrow,
  title,
  meta,
  cover,
  variant = 'collection',
  onCoverClick,
  coverLabel,
  coverBusy,
  description,
  children,
}: CollectionHeaderProps) {
  const v = VARIANTS[variant];
  const boxClassName = cn('shrink-0', v.cover, v.radius);
  const coverClassName = cn('h-full w-full', v.radius);

  return (
    <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
      {onCoverClick ? (
        <button
          type="button"
          onClick={onCoverClick}
          disabled={coverBusy}
          className={cn(
            'group relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            boxClassName,
          )}
          aria-label={coverLabel}
          title={coverLabel}
        >
          <CollectionCover {...cover} className={coverClassName} />
          <span className="absolute inset-0 grid place-items-center bg-black/40 text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            {coverBusy ? 'Uploading…' : 'Change cover'}
          </span>
        </button>
      ) : (
        <div className={cn('relative', boxClassName)}>
          <CollectionCover {...cover} className={coverClassName} />
        </div>
      )}
      <div className={v.text}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-hero-title">{title}</h1>
        {meta.length > 0 && (
          <div className="mt-3 text-sm text-muted-foreground">
            {meta.map((entry, i) => (
              <Fragment key={i}>
                {i > 0 ? ' · ' : null}
                {entry}
              </Fragment>
            ))}
          </div>
        )}
        {description}
        {children}
      </div>
    </div>
  );
}
