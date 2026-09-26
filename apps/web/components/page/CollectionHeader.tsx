import { Fragment, type ReactNode } from 'react';
import { CollectionCover, type CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { Eyebrow } from '@/components/page/Eyebrow';
import { cn } from '@/lib/utils';

export type CollectionHeaderVariant = 'collection' | 'album' | 'artist';

// Every page family shipped its own hero geometry, so the variant keeps the
// exact cover size, radius and text-column behaviour each one had:
// collection (playlists, Liked, Recent, Uploads) 176 -> 192px rounded card,
// album (and the track page) 176 -> 224px, artist 144 -> 176px circle.
export const HEADER_VARIANTS: Record<CollectionHeaderVariant, { cover: string; radius: string; text: string }> = {
  collection: { cover: 'size-art-hero md:size-art-lg', radius: 'rounded-2xl', text: 'min-w-0 w-full md:w-auto' },
  album: { cover: 'size-art-hero md:size-art-xl', radius: 'rounded-md', text: 'min-w-0 w-full md:w-auto' },
  artist: { cover: 'size-art-hero-sm md:size-art-hero', radius: 'rounded-full', text: 'min-w-0 w-full md:w-auto' },
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

/** The header's geometry as class strings, exported so CollectionSkeleton
 *  sketches the identical stack: cover
 *  to text `stack` 24, eyebrow to title and title to meta `cluster` 8, a
 *  description `block` 16 under the meta, and the action bar `stack` 24
 *  under that, inside the text column ("Beside"), so on desktop its bottom
 *  edge lands on the cover's bottom edge (md:items-end). The header sets no
 *  outer margin: its parent spaces it. */
export const HEADER_CLASSES = {
  root: 'flex flex-col md:flex-row items-start md:items-end gap-stack',
  title: 'mt-cluster',
  meta: 'mt-cluster',
  description: 'mt-block',
  actions: 'mt-stack',
} as const;

/** Presentational only: a collection's title block, shared by the playlist
 *  page, Liked/Recent/Uploads, and the album, artist and track heroes.
 *  `children` is the action bar, which sits in the text column beside the
 *  cover on desktop (md:flex-row items-end). */
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
  const v = HEADER_VARIANTS[variant];
  const boxClassName = cn('shrink-0', v.cover, v.radius);
  const coverClassName = cn('h-full w-full', v.radius);

  return (
    <div className={HEADER_CLASSES.root} data-testid="collection-header">
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
      <div className={v.text || undefined}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className={cn('text-hero-title break-words line-clamp-3', HEADER_CLASSES.title)}>{title}</h1>
        {meta.length > 0 && (
          <div data-testid="collection-meta" className={cn('text-meta', HEADER_CLASSES.meta)}>
            {meta.map((entry, i) => (
              <Fragment key={i}>
                {i > 0 ? ' · ' : null}
                {entry}
              </Fragment>
            ))}
          </div>
        )}
        {description ? <div className={HEADER_CLASSES.description}>{description}</div> : null}
        {children ? <div className={HEADER_CLASSES.actions}>{children}</div> : null}
      </div>
    </div>
  );
}
